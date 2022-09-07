import app from "$app";
import config from "$config";
import store from "$lib/store";
import { auth, optionalAuth } from "$lib/passport";
import { getUser } from "$lib/utils";
import axios from "axios";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import getAccount from "$lib/account";
import Sequelize from "@sequelize/core";
import bitcoin from "bitcoinjs-lib";
import liquid from "liquidjs-lib";
import { fromBase58, fromPrivateKey } from "bip32";
import { Mutex } from "async-mutex";
import bip32 from "bip32";
import whitelist from "$lib/whitelist";
import { l, err, warn } from "$lib/logging";
import db from "$db";
import bc from "$lib/bitcoin";
import lq from "$lib/liquid";
import { emit } from "$lib/sockets";
import register from "$lib/register";

const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});

const twofa = (req, res, next) => {
  let {
    user,
    body: { token }
  } = req;
  if (
    user.twofa &&
    (typeof token === "undefined" ||
      !authenticator.check(token, user.otpsecret))
  ) {
    return res.status(401).send("2fa required");
  } else next();
};

app.get("/me", auth, async (req, res) => {
  let user = req.user.get({ plain: true });
  let payments = await req.user.getPayments({
    where: {
      account_id: user.account_id
    },
    order: [["id", "DESC"]],
    limit: 12,
    include: [
      {
        model: db.Account,
        as: "account"
      },
      {
        model: db.Payment,
        as: "fee_payment"
      }
    ]
  });
  user.accounts = await req.user.getAccounts();
  user.payments = payments;
  res.send(user);
});

app.get("/users/:username", async (req, res) => {
  const { username } = req.params;

  const user = await db.User.findOne({
    attributes: ["username"],
    where: Sequelize.where(
      Sequelize.fn("lower", Sequelize.col("username")),
      username.toLowerCase()
    )
  });

  if (user) res.send(user);
  else res.code(500).send("User not found");
});

app.post("/register", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const user = await register(req.body.user, ip, false);
    res.send(pick(user, ...whitelist));
  } catch (e) {
    res.code(500).send(e.message);
  }
});

app.post("/disable2fa", auth, twofa, async (req, res) => {
  let { user } = req;
  user.twofa = false;
  await user.save();
  emit(user.username, "user", user);
  emit(user.username, "otpsecret", user.otpsecret);
  l("disabled 2fa", user.username);
  res.send({});
});

app.get("/otpsecret", auth, twofa, async (req, res) => {
  let { user } = req;
  emit(user.username, "otpsecret", user.otpsecret);
  res.send({});
});

app.post("/2fa", auth, async (req, res) => {
  let { user } = req;
  try {
    const isValid = authenticator.check(req.body.token, req.user.otpsecret);
    if (isValid) {
      user.twofa = true;
      user.save();
      emit(user.username, "user", req.user);
    } else {
      return res.code(500).send("Invalid token");
    }
  } catch (e) {
    err("error setting up 2fa", e);
  }

  l("enabled 2fa", user.username);
  res.send({});
});

app.get("/exists", async (req, res) => {
  let exists = await db.User.findOne({
    where: { username: req.query.username }
  });

  res.send(!!exists);
});

app.post("/user", auth, async (req, res) => {
  try {
    let { user } = req;
    let {
      address,
      confirm,
      currencies,
      currency,
      email,
      fiat,
      password,
      pin,
      seed,
      tokens,
      twofa,
      unit,
      username
    } = req.body;

    let exists = await db.User.findOne({
      where: { username }
    });

    let token;
    if (user.username !== username && exists) {
      err("username taken", username, user.username, exists.username);
      return res.code(500).send("Username taken");
    } else {
      store.sockets[username] = store.sockets[user.username];
      if (user.username !== username)
        l("changing username", user.username, username);
      user.username = username;

      token = jwt.sign({ username }, config.jwt);
      res.cookie("token", token, {
        expires: new Date(Date.now() + 432000000)
      });
    }

    if (unit) user.unit = unit;
    user.currency = currency;
    user.currencies = currencies;

    user.tokens = tokens;
    user.twofa = twofa;
    user.pin = pin;
    user.seed = seed;
    user.fiat = fiat;
    user.email = email;
    user.address = address;

    if (password && password === confirm) {
      user.password = await bcrypt.hash(password, 1);
    }

    await user.save();
    emit(user.username, "user", user);
    res.send({ user, token });
  } catch (e) {
    err("error updating user", e.message);
  }
});

app.post("/keys", auth, async (req, res) => {
  const { key: hex } = req.body;
  const key = await db.Key.create({
    user_id: req.user.id,
    hex
  });
  emit(req.user.username, "key", key);
  res.send(key);
});

app.post("/keys/delete", auth, async (req, res) => {
  const { hex } = req.body;
  (
    await db.Key.findOne({
      where: {
        user_id: req.user.id,
        hex
      }
    })
  ).destroy();
});

app.post("/updateSeeds", auth, async (req, res) => {
  let { user } = req;
  let { seeds } = req.body;
  let keys = Object.keys(seeds);

  for (let i = 0; i < keys.length; i++) {
    let id = keys[i];
    let seed = seeds[id];
    await db.Account.update(
      { seed },
      {
        where: { id, user_id: user.id }
      }
    );

    const account = await db.Account.findOne({
      where: { id }
    });

    emit(user.username, "account", account);
  }

  res.send({});
});

app.post("/accounts/delete", auth, async (req, res) => {
  const { id } = req.body;
  const account = await db.Account.findOne({ where: { id } });
  if (account) await account.destroy();
  res.send({});
});

app.post("/accounts", auth, async (req, res) => {
  const {
    name,
    seed,
    pubkey,
    ticker,
    precision,
    path,
    privkey,
    network
  } = req.body;
  const { user } = req;

  let account = await db.Account.create({
    user_id: user.id,
    asset: config.liquid.btcasset,
    balance: 0,
    pending: 0,
    name,
    ticker,
    precision,
    pubkey,
    privkey,
    seed,
    path,
    network
  });

  emit(user.username, "account", account);

  if (pubkey) user.index++;
  user.account_id = account.id;
  await user.save();
  user.account = account;
  emit(user.username, "user", user);

  res.send(account);
});

let login = async (req, res) => {
  try {
    const { params, sig, key } = req.body;

    if (sig) {
      const { callback } = params;

      console.log(params, sig, key)

      try {
        const url = `${callback}&sig=${sig}&key=${key}`;
        console.log(url)
        const response = await axios.get(url);
        res.send(response.data);
      } catch (e) {
        err("problem calling lnurl login", e.message);
        res.code(500).send(e.message);
      }

      return;
    }

    let twofa = req.body.token;

    let user = await getUser(req.body.username);

    if (
      !user ||
      (user.password &&
        !(await bcrypt.compare(req.body.password, user.password)))
    ) {
      warn("invalid username or password attempt", req.body.username);
      return res.status(401).send({});
    }

    if (
      user.twofa &&
      (typeof twofa === "undefined" ||
        !authenticator.check(twofa, user.otpsecret))
    ) {
      return res.status(401).send("2fa required");
    }

    l(
      "login",
      req.body.username,
      req.headers["x-forwarded-for"] || req.connection.remoteAddress
    );

    let payload = { username: user.username };
    let token = jwt.sign(payload, config.jwt);
    res.cookie("token", token, { expires: new Date(Date.now() + 432000000) });
    user.accounts = await user.getAccounts();
    user.keys = await user.getKeys();
    user = pick(user, ...whitelist);
    res.send({ user, token });
  } catch (e) {
    err("login error", e.message, req.connection.remoteAddress);
    res.status(401).send({});
  }
};

app.post("/login", login);
app.post("/taboggan", login);
app.post("/doggin", login);

app.post("/logout", optionalAuth, async (req, res) => {
  let { subscription } = req.body;
  if (!subscription) return res.send({});

  const { username } = req.user;

  if (username) {
    l("logging out", username);
    let i = req.user.subscriptions.findIndex(
      s => JSON.stringify(s) === subscription
    );
    if (i > -1) {
      req.user.subscriptions.splice(i, 1);
    }
    await req.user.save();
    Object.keys(logins).map(
      k => logins[k]["username"] === username && delete logins[k]
    );
  }

  res.send({});
});

app.get("/address", async (req, res) => {
  let { network, type } = req.query;
  let address, confidentialAddress;

  let paymentType = {
    bech32: "p2wpkh",
    "p2sh-segwit": "p2sh",
    legacy: "p2pkh"
  }[type];
  if (!paymentType) paymentType = "p2wpkh";

  let hd, i, p, n;
  const mutex = new Mutex();
  const release = await mutex.acquire();
  try {
    if (network === "bitcoin") {
      if (!config.bitcoin) return res.code(500).send("Bitcoin not configured");

      address = await bc.getNewAddress("", type);
      store.bcAddressIndex = i + 1;
      return res.send({ address });

      p = bitcoin.payments;
      n = prod ? bitcoin.networks["bitcoin"] : bitcoin.networks["regtest"];

      i = parseInt(store.bcAddressIndex);
      hd = fromBase58(config.bitcoin.masterkey, n).derivePath(`m/0'/0'/${i}'`);

      // async request to node to bump its internal index but don't use result
      bc.getNewAddress().catch(console.error);
      res.send({ address, confidentialAddress });

      store.bcAddressIndex = i + 1;
    } else if (network === "liquid") {
      p = liquid.payments;
      n =
        liquid.networks[
          config.liquid.network === "mainnet" ? "liquid" : config.liquid.network
        ];
      paymentType = "p2sh";

      // async request to node to bump its internal index but don't use result
      lq.getNewAddress().catch(e =>
        warn("Problem bumping liquid address index", e.message)
      );

      i = parseInt(store.lqAddressIndex);

      if (!i) {
        const { hdkeypath } = await lq.getAddressInfo(await lq.getNewAddress());
        const parts = hdkeypath.split("/");
        i = parseInt(parts[parts.length - 1].slice(0, -1));
      }

      l("liquid address index", i);
      if (!i) throw new Error("Problem generating address");

      hd = fromBase58(config.liquid.masterkey, n).derivePath(`m/0'/0'/${i}'`);
      store.lqAddressIndex = i + 1;
    } else {
      throw new Error("Unsupported network");
    }
  } finally {
    release();
  }

  if (paymentType !== "p2sh") {
    ({ address } = p[paymentType]({
      pubkey: hd.publicKey,
      network: n
    }));
  } else {
    if (network === "liquid") {
      const p2wpkh = p.p2wpkh({
        pubkey: hd.publicKey,
        network: n
      });

      const blindkey = fromPrivateKey(
        Buffer.from(config.liquid.blindkey, "hex"),
        hd.chainCode,
        n
      );

      ({ address, confidentialAddress } = p[paymentType]({
        redeem: p2wpkh,
        network: n,
        blindkey: blindkey.publicKey
      }));

      lq.importBlindingKey(
        confidentialAddress,
        blindkey.privateKey.toString("hex")
      );
    } else {
      ({ address } = p[paymentType]({
        redeem: p.p2wpkh({
          pubkey: hd.publicKey,
          network: n
        }),
        network: n
      }));
    }
  }

  res.send({ address, confidentialAddress });
});

app.post("/account", auth, async (req, res) => {
  const { user } = req;
  const {
    id,
    name,
    ticker,
    precision,
    domain,
    seed,
    pubkey,
    privkey,
    path,
    hide,
    index
  } = req.body;

  try {
    await db.transaction(async transaction => {
      let account = await db.Account.findOne({
        where: { id, user_id: user.id },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      let params = {
        name,
        ticker,
        precision,
        domain,
        seed,
        pubkey,
        path,
        hide,
        index,
        privkey
      };

      if (!account || (account.pubkey && !pubkey)) delete params.pubkey;

      await db.Account.update(params, {
        where: { id, user_id: user.id },
        transaction
      });

      await account.reload({ transaction });
      emit(user.username, "account", account);
      res.send({});
    });
  } catch (e) {
    err("problem updating account", e.message);
    return res.code(500).send("There was a problem updating the account");
  }
});

app.post("/shiftAccount", auth, async (req, res) => {
  let { user } = req;
  let { id } = req.body;

  try {
    const account = await db.Account.findOne({
      where: { id }
    });

    if (account.user_id !== user.id)
      return res.code(500).send("Failed to open wallet");

    user.account_id = account.id;
    await user.save();
    let payments = await db.Payment.findAll({
      where: {
        account_id: id
      },
      order: [["id", "DESC"]],
      limit: 12,
      include: {
        model: db.Account,
        as: "account"
      }
    });

    user = user.get({ plain: true });
    user.payments = payments;
    user.account = account.get({ plain: true });

    emit(user.username, "account", user.account);
    emit(user.username, "user", user);

    res.send(user);
  } catch (e) {
    err("problem switching account", e.message);
    return res.code(500).send("There was a problem switching accounts");
  }
});

app.get("/vapidPublicKey", function(req, res) {
  res.send(config.vapid.publicKey);
});

app.post("/subscribe", auth, async function(req, res) {
  let { subscriptions } = req.user;
  let { subscription } = req.body;
  if (!subscriptions) subscriptions = [];
  if (
    !subscriptions.find(s => JSON.stringify(s) === JSON.stringify(subscription))
  )
    subscriptions.push(subscription);
  req.user.subscriptions = subscriptions;
  l("subscribing", req.user.username);
  await req.user.save();
  res.sendStatus(201);
});

let redeeming = {};
app.post("/redeem", optionalAuth, async function(req, res) {
  const { redeemcode } = req.body;
  try {
    await db.transaction(async transaction => {
      if (redeeming[redeemcode]) fail("redemption in progress");
      redeeming[redeemcode] = true;
      if (!redeemcode) fail("no code provided");

      let { user } = req;

      const source = await db.Payment.findOne({
        where: {
          redeemcode: req.body.redeemcode
        },
        include: {
          model: db.Account,
          as: "account"
        },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      l("redeeming", redeemcode);

      if (!source) fail("Invalid code");
      if (source.redeemed) fail("Voucher has already been redeemed");
      let { amount } = source;
      amount = -amount;

      if (!user) {
        const ip =
          req.headers["x-forwarded-for"] || req.connection.remoteAddress;

        user = await register(
          {
            username: redeemcode.substr(0, 8),
            password: ""
          },
          ip,
          false
        );

        let payload = { username: user.username };
        let token = jwt.sign(payload, config.jwt);
        res.cookie("token", token, {
          expires: new Date(Date.now() + 432000000)
        });

        delete redeeming[redeemcode];
        return res.send({ user });
      }

      let account = await getAccount(source.account.asset, user, transaction);
      let { hash, memo, confirmed, fee, network } = source;

      source.redeemed = true;
      await source.save({ transaction });

      let payment = await db.Payment.create(
        {
          amount,
          account_id: account.id,
          user_id: user.id,
          hash: "Voucher " + redeemcode,
          memo,
          rate: store.rates[user.currency],
          currency: user.currency,
          confirmed,
          network,
          received: true,
          fee
        },
        { transaction }
      );

      await account.increment({ balance: amount }, { transaction });
      await account.reload({ transaction });

      payment = payment.get({ plain: true });
      payment.account = account.get({ plain: true });
      emit(user.username, "payment", payment);
      emit(user.username, "account", account);

      res.send({ payment });
    });
  } catch (e) {
    delete redeeming[redeemcode];
    console.log(e)
    err("problem redeeming", e.message);
    return res.code(500).send("There was a problem redeeming the voucher");
  }
});

app.post("/checkRedeemCode", auth, async function(req, res) {
  const { redeemcode } = req.body;

  const payment = await db.Payment.findOne({ where: { redeemcode } });
  res.send(payment);
});

app.post("/password", auth, async function(req, res) {
  const { user } = req;
  const { password } = req.body;

  if (!user.password) return res.send(true);
  res.send(await bcrypt.compare(password, user.password));
});

app.get("/isInternal", auth, async function(req, res) {
  let { user } = req;
  let { address } = req.query;
  if (!address) throw new Error("Address not provided");

  let invoice = await db.Invoice.findOne({
    where: { address },
    include: {
      attributes: ["username"],
      model: db.User,
      as: "user"
    }
  });

  if (invoice) {
    let info;
    try {
      info = await bc.getAddressInfo(address);
    } catch (e) {
      info = await lq.getAddressInfo(address);
    }
    if (info.ismine) {
      emit(user.username, "to", invoice.user);
      return res.send(true);
    }
  }

  res.send(false);
});

app.get("/invoices", auth, async function(req, res) {
  let invoices = await db.Invoice.findAll({
    where: { user_id: req.user.id }
  });
  res.send(invoices);
});

app.post("/signMessage", auth, async function(req, res) {
  let { address, message } = req.body;

  let invoices = await db.Invoice.findAll({
    where: { user_id: req.user.id }
  });

  if (invoices.find(i => i.address === address)) {
    if (config.bitcoin.walletpass)
      await bc.walletPassphrase(config.bitcoin.walletpass, 300);
    return res.send(await bc.signMessage(address, message));
  }

  res.code(500).send("Address not found for user");
});
