import app from "$app";
import redis from "$lib/redis";
import config from "$config";
import store from "$lib/store";
import { auth, optionalAuth } from "$lib/passport";
import { getUser, nada, uniq, wait } from "$lib/utils";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import Sequelize from "@sequelize/core";
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
import { requirePin } from "$lib/utils";
import { coinos, q } from "$lib/nostr";
import got from "got";
import { bech32 } from "bech32";

const { encode, decode, fromWords, toWords } = bech32;

const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});

app.get("/me", auth, async (req, res) => {
  try {
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
    user.haspin = !!user.pin;

    res.send(pick(user, ...whitelist));
  } catch (e) {
    console.log("problem fetching user", e);
    res.code(500).send(e.message);
  }
});

app.get("/users/:username", async (req, res) => {
  try {
    let { username } = req.params;

    if (username.startsWith("npub")) {
      username = Buffer.from(fromWords(decode(username).words)).toString("hex");
    }

    let user = await db.User.findOne({
      attributes: [
        "username",
        "banner",
        "profile",
        "address",
        "currency",
        "pubkey",
        "display",
        "prompt",
        "uuid"
      ],
      where: {
        [Sequelize.Op.or]: [
          Sequelize.where(
            Sequelize.fn("lower", Sequelize.col("username")),
            username.toLowerCase()
          ),
          { pubkey: username }
        ]
      }
    });

    if (user) user = user.get({ plain: true });
    else user = JSON.parse(await redis.get(`user:${username}`));

    if (!user && username.length === 64) {
      let newuser = {
        username: username.substr(0, 6),
        pubkey: username,
        anon: true
      };

      user = JSON.parse(await redis.get(`user:${newuser.pubkey}`)) || newuser;
    }

    if (!user) return res.code(500).send("User not found");

    res.send(user);
  } catch (e) {
    console.log(e);
    res.code(500).send(e.message);
  }
});

app.post("/register", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    let { cipher, pubkey, password, username, salt } = req.body.user;

    let user = {
      cipher,
      pubkey,
      password,
      username,
      salt
    };

    user = await register(user, ip, false);
    l("registered new user", username);
    res.send(pick(user, ...whitelist));
  } catch (e) {
    res.code(500).send(e.message);
  }
});

app.post("/disable2fa", auth, async (req, res) => {
  try {
    let {
      user,
      body: { token }
    } = req;

    if (user.twofa && !authenticator.check(token, user.otpsecret)) {
      return res.code(401).send("2fa required");
    }

    user.twofa = false;
    await user.save();
    emit(user.username, "user", user);
    emit(user.username, "otpsecret", user.otpsecret);
    l("disabled 2fa", user.username);
    res.send({});
  } catch (e) {
    res.code(500).send("Problem disabling 2fa");
  }
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

    l("updating user", user.username);

    let { confirm, password, pin, newpin, username } = req.body;

    if (user.pin && !(pin === user.pin)) throw new Error("Pin required");
    if (typeof newpin !== "undefined") user.pin = newpin;
    if (!user.pin) user.pin = null;

    let exists;

    if (username)
      exists = await db.User.findOne({
        where: { username }
      });

    let token;
    if (user.username !== username && exists) {
      err("username taken", username, user.username, exists.username);
      throw new Error("Username taken");
    } else if (username) {
      store.sockets[username] = store.sockets[user.username];
      if (user.username !== username)
        l("changing username", user.username, username);
      user.username = username;
    }

    let attributes = [
      "address",
      "cipher",
      "currencies",
      "currency",
      "display",
      "email",
      "fiat",
      "locktime",
      "prompt",
      "pubkey",
      "salt",
      "seed",
      "tokens",
      "twofa",
      "unit"
    ];

    for (let a of attributes) {
      if (req.body[a]) user[a] = req.body[a];
    }

    if (password && password === confirm) {
      user.password = await bcrypt.hash(password, 1);
    }

    await user.save();

    user = user.get({ plain: true });
    user.haspin = !!user.pin;

    emit(user.username, "user", user);
    res.send({ user, token });
  } catch (e) {
    console.log(e);
    err("error updating user", e.message);
    res.code(500).send(e.message);
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
    const { params, sig, key, password, username, token: twofa } = req.body;

    if (sig) {
      const { callback } = params;

      try {
        const url = `${callback}&sig=${sig}&key=${key}`;
        const response = await got(url).json();
        res.send(response);
      } catch (e) {
        err("problem calling lnurl login", e.message);
        res.code(500).send(e.message);
      }

      return;
    }

    let user = await getUser(username);

    if (
      !user ||
      (user.password && !(await bcrypt.compare(password, user.password)))
    ) {
      warn("invalid username or password attempt", username);
      return res.code(401).send({});
    }

    if (
      user.twofa &&
      (typeof twofa === "undefined" ||
        !authenticator.check(twofa, user.otpsecret))
    ) {
      return res.code(401).send("2fa required");
    }

    l(
      "login",
      username,
      req.headers["x-forwarded-for"] || req.connection.remoteAddress
    );

    let payload = { username, uuid: user.uuid };
    let token = jwt.sign(payload, config.jwt);
    res.cookie("token", token, { expires: new Date(Date.now() + 432000000) });
    user.accounts = await user.getAccounts();
    user.keys = await user.getKeys();
    user = pick(user, ...whitelist);
    res.send({ user, token });
  } catch (e) {
    err("login error", e.message, req.connection.remoteAddress);
    res.code(401).send({});
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

app.post("/otpsecret", auth, async function(req, res) {
  try {
    await requirePin(req);
    let { otpsecret, username } = req.user;
    res.send({ secret: otpsecret, username });
  } catch (e) {
    res.code(500).send(e.message);
  }
});

app.get("/contacts", auth, async function(req, res) {
  try {
    let contacts = await db.Payment.findAll({
      where: {
        user_id: req.user.id,
        with_id: { [Sequelize.Op.ne]: null }
      },
      include: {
        attributes: ["username", "profile"],
        model: db.User,
        as: "with"
      },
      attributes: [
        [Sequelize.fn("max", Sequelize.col("payments_model.createdAt")), "last"]
      ],
      group: ["with_id"],
      order: [[{ model: db.User, as: "with" }, "username", "ASC"]]
    });

    res.send(
      contacts.map(c => {
        c = c.get({ plain: true });
        return { ...c.with, last: c.last };
      })
    );
  } catch (e) {
    console.log(e);
    res.code(500).send(e.message);
  }
});

app.post("/checkPassword", auth, async function(req, res) {
  try {
    let { user } = req;
    let result = await bcrypt.compare(req.body.password, user.password);
    if (!result) throw new Error();
    res.send(result);
  } catch (e) {
    res.code(500).send("Invalid password");
  }
});

app.get("/:pubkey/follows", async (req, res) => {
  try {
    let { pubkey } = req.params;
    let { tagsonly } = req.query;

    let sub = `${pubkey}:follows`;
    q(
      sub,
      {
        limit: 1,
        kinds: [3],
        authors: [pubkey]
      },
      60000,
      3600,
      60000
    ).catch(nada);

    let tags = JSON.parse(await redis.get(`${pubkey}:follows`)) || [];
    if (tagsonly) return res.send(tags);

    let follows = [];
    for (let f of tags) {
      let [_, pubkey] = f;

      q(`${pubkey}:profile:f1`, {
        limit: 1,
        kinds: [0],
        authors: [pubkey]
      }).catch(nada);

      let user = JSON.parse(await redis.get(`user:${pubkey}`));

      if (!user)
        user = {
          username: pubkey.substr(0, 6),
          pubkey,
          anon: true
        };

      follows.push(user);
    }

    follows = uniq(follows, e => e.pubkey);
    follows.sort((a, b) => a.username.localeCompare(b.username));

    res.send(follows);
  } catch (e) {
    console.log(e);
    res.code(500).send(e && e.message);
  }
});

app.get("/:pubkey/followers", async (req, res) => {
  try {
    let { pubkey } = req.params;

    let pubkeys = [
      ...new Set([
        ...(await got(`${config.nostr}/followers?pubkey=${pubkey}`).json()),
        ...(await redis.sMembers(`${pubkey}:followers`))
      ])
    ];

    let followers = [];

    q(
      `${pubkey}:followers`,
      { kinds: [3], "#p": [pubkey] },
      60000,
      3600,
      60000
    ).catch(nada);

    for (let pubkey of pubkeys) {
      let user = JSON.parse(await redis.get(`user:${pubkey}`));
      if (!user || !user.updated) {
        q(`${pubkey}:profile:f2`, {
          limit: 1,
          kinds: [0],
          authors: [pubkey]
        }).catch(nada);

        user = JSON.parse(await redis.get(`user:${pubkey}`));
      }

      if (!user)
        user = {
          username: pubkey.substr(0, 6),
          pubkey,
          anon: true
        };

      followers.push(user);
    }

    followers = uniq(followers, e => e.pubkey);
    followers.sort((a, b) => a.username.localeCompare(b.username));

    res.send(followers);
  } catch (e) {
    console.log(e);
    res.code(500).send(e && e.message);
  }
});
