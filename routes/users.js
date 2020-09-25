const axios = require("axios");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const authenticator = require("otplib").authenticator;
const textToImage = require("text-to-image");
const randomWord = require("random-words");
const getAccount = require("../lib/account");
const Sequelize = require("sequelize");

const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});
require("../lib/whitelist");

const twofa = ah((req, res, next) => {
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
});

app.get(
  "/users/:username",
  ah(async (req, res) => {
    const { username } = req.params;

    const user = await db.User.findOne({
      attributes: ["username"],
      where: Sequelize.where(
        Sequelize.fn("lower", Sequelize.col("username")),
        username.toLowerCase()
      )
    });

    if (user) res.send(user);
    else res.status(500).send("User not found");
  })
);

app.get(
  "/challenge",
  ah(async (req, res) => {
    const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    challenge[ip] = randomWord();
    l.info("setting up challenge", ip, challenge[ip]);
    const data = await textToImage.generate(challenge[ip]);
    res.send(data);
  })
);

app.post(
  "/register",
  ah(async (req, res) => {
    try {
      const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
      const user = await register(req.body.user, ip, false);
      res.send(pick(user, ...whitelist));
    } catch (e) {
      res.status(500).send(e.message);
    }
  })
);

app.post(
  "/disable2fa",
  auth,
  twofa,
  ah(async (req, res) => {
    let { user } = req;
    user.twofa = false;
    await user.save();
    emit(user.username, "user", user);
    emit(user.username, "otpsecret", user.otpsecret);
    l.info("disabled 2fa", user.username);
    res.end();
  })
);

app.get(
  "/otpsecret",
  auth,
  twofa,
  ah(async (req, res) => {
    let { user } = req;
    emit(user.username, "otpsecret", user.otpsecret);
    res.end();
  })
);

app.post(
  "/2fa",
  auth,
  ah(async (req, res) => {
    let { user } = req;
    try {
      const isValid = authenticator.check(req.body.token, req.user.otpsecret);
      if (isValid) {
        user.twofa = true;
        user.save();
        emit(user.username, "user", req.user);
      } else {
        return res.status(500).send("Invalid token");
      }
    } catch (e) {
      l.error("error setting up 2fa", e);
    }

    l.info("enabled 2fa", user.username);
    res.end();
  })
);

app.get(
  "/exists",
  ah(async (req, res) => {
    let exists = await db.User.findOne({
      where: { username: req.query.username }
    });

    res.send(!!exists);
  })
);

app.post(
  "/user",
  auth,
  ah(async (req, res) => {
    try {
      let { user } = req;
      let {
        username,
        fiat,
        unit,
        currency,
        currencies,
        twofa,
        pin,
        password,
        confirm,
        tokens,
        seed
      } = req.body;

      let exists = await db.User.findOne({
        where: { username }
      });

      let token;
      if (user.username !== username && exists) {
        return res.status(500).send("Username taken");
      } else {
        sockets[username] = sockets[user.username];
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

      if (password && password === confirm) {
        user.password = await bcrypt.hash(password, 1);
      }

      await user.save();
      emit(user.username, "user", user);
      res.send({ user, token });
    } catch (e) {
      l.error("error updating user", e.message);
    }
  })
);

app.post(
  "/keys",
  auth,
  ah(async (req, res) => {
    const { key: hex } = req.body;
    const key = await db.Key.create({
      user_id: req.user.id,
      hex
    });
    emit(req.user.username, "key", key);
  })
);

app.post(
  "/keys/delete",
  auth,
  ah(async (req, res) => {
    const { hex } = req.body;
    (
      await db.Key.findOne({
        where: {
          user_id: req.user.id,
          hex
        }
      })
    ).destroy();
  })
);

app.post(
  "/updateSeeds",
  auth,
  ah(async (req, res) => {
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

    res.end();
  })
);

app.post(
  "/accounts/delete",
  auth,
  ah(async (req, res) => {
    const { id } = req.body;
    const account = await db.Account.findOne({ where: { id } });
    if (account) await account.destroy();
    res.end();
  })
);

app.post(
  "/accounts",
  auth,
  ah(async (req, res) => {
    const { name, seed, pubkey, ticker, precision, path, network } = req.body;
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
  })
);

app.post(
  "/login",
  ah(async (req, res) => {
    const { params, sig, key } = req.body;

    if (sig) {
      const { callback } = params;

      try {
        const url = `${callback}&sig=${sig}&key=${key}`;
        const response = await axios.get(url);
        res.send(response.data);
      } catch (e) {
        l.error("problem calling lnurl login", e.message);
        res.status(500).send(e.message);
      }

      return;
    }

    let twofa = req.body.token;
    l.info(
      "login",
      req.body.username,
      req.headers["x-forwarded-for"] || req.connection.remoteAddress
    );

    try {
      let user = await getUser(req.body.username);

      if (
        !user ||
        (user.password &&
          !(await bcrypt.compare(req.body.password, user.password)))
      ) {
        l.warn(
          "invalid username or password attempt",
          req.body.username,
          req.body.password
        );
        return res.status(401).end();
      }

      if (
        user.twofa &&
        (typeof twofa === "undefined" ||
          !authenticator.check(twofa, user.otpsecret))
      ) {
        return res.status(401).send("2fa required");
      }

      let payload = { username: user.username };
      let token = jwt.sign(payload, config.jwt);
      res.cookie("token", token, { expires: new Date(Date.now() + 432000000) });
      user.accounts = await user.getAccounts();
      user.keys = await user.getKeys();
      user = pick(user, ...whitelist);
      res.send({ user, token });
    } catch (e) {
      l.error("login error", e.message);
      res.status(401).end();
    }
  })
);

app.post(
  "/logout",
  optionalAuth,
  ah(async (req, res) => {
    let { subscription } = req.body;
    if (!subscription) return res.end();

    const { username } = req.user;

    if (username) {
      l.info("logging out", username);
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

    res.end();
  })
);

app.get(
  "/address",
  ah(async (req, res) => {
    const { network, type } = req.query;
    let address;

    if (network === "bitcoin") {
      if (!config.bitcoin)
        return res.status(500).send("Bitcoin not configured");

      if (config.bitcoin.walletpass)
        await bc.walletPassphrase(config.bitcoin.walletpass, 300);

      address = await bc.getNewAddress("", type || "bech32");
    } else if (network === "liquid") {
      if (!config.liquid) return res.status(500).send("Liquid not configured");

      if (config.liquid.walletpass)
        await lq.walletPassphrase(config.liquid.walletpass, 300);

      address = await lq.getNewAddress("", type || "bech32");
    }

    res.send(address);
  })
);

app.post(
  "/account",
  auth,
  ah(async (req, res) => {
    const { user } = req;
    const {
      id,
      name,
      ticker,
      precision,
      domain,
      seed,
      pubkey,
      path,
      hide,
      index
    } = req.body;

    try {
      await db.Account.update(
        { name, ticker, precision, domain, seed, pubkey, path, hide, index },
        {
          where: { id, user_id: user.id }
        }
      );

      const account = await db.Account.findOne({
        where: { id }
      });

      emit(user.username, "account", account);
      res.end();
    } catch (e) {
      l.error(e.message);
      return res.status(500).send("There was a problem updating the account");
    }
  })
);

app.post(
  "/shiftAccount",
  auth,
  ah(async (req, res) => {
    let { user } = req;
    let { id } = req.body;

    try {
      const account = await db.Account.findOne({
        where: { id, user_id: user.id }
      });

      user.account_id = account.id;
      await user.save();
      let payments = await db.Payment.findAll({
        where: {
          user_id: user.id,
          account_id: id
        },
        order: [["id", "DESC"]],
        limit: 12,
        include: {
          model: db.Account,
          as: "account"
        }
      });
      user.payments = payments;
      user.account = account.get({ plain: true });

      emit(user.username, "account", user.account);
      emit(user.username, "user", user);

      res.send(user);
    } catch (e) {
      l.error(e.message);
      return res.status(500).send("There was a problem switching accounts");
    }
  })
);

app.get("/vapidPublicKey", function(req, res) {
  res.send(config.vapid.publicKey);
});

app.post(
  "/subscribe",
  auth,
  ah(async function(req, res) {
    let { subscriptions } = req.user;
    let { subscription } = req.body;
    if (!subscriptions) subscriptions = [];
    if (
      !subscriptions.find(
        s => JSON.stringify(s) === JSON.stringify(subscription)
      )
    )
      subscriptions.push(subscription);
    req.user.subscriptions = subscriptions;
    l.info("subscribing", req.user.username);
    await req.user.save();
    res.sendStatus(201);
  })
);

app.post(
  "/redeem",
  optionalAuth,
  ah(async function(req, res) {
    const { redeemcode } = req.body;
    if (!redeemcode) fail("no code provided");

    let { user } = req;

    const source = await db.Payment.findOne({
      where: {
        redeemcode: req.body.redeemcode
      },
      include: {
        model: db.Account,
        as: "account"
      }
    });

    l.info("redeeming", redeemcode);

    if (!source) fail("Invalid code");
    if (source.redeemed) fail("Voucher has already been redeemed");

    if (!user) {
      const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
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
      res.cookie("token", token, { expires: new Date(Date.now() + 432000000) });
      return res.send({ user });
    } else {
      l.info("user", user.username);
    }

    await db.transaction(async transaction => {
      let account = await getAccount(source.account.asset, user, transaction);
      let { hash, memo, confirmed, fee, network } = source;

      source.redeemed = true;
      await source.save();

      let payment = await db.Payment.create(
        {
          amount: -source.amount,
          account_id: account.id,
          user_id: user.id,
          hash: "Voucher " + redeemcode,
          memo,
          rate: app.get("rates")[user.currency],
          currency: user.currency,
          confirmed,
          network,
          received: true,
          fee
        },
        { transaction }
      );

      account.balance -= source.amount;
      await account.save();

      payment = payment.get({ plain: true });
      payment.account = account.get({ plain: true });
      emit(user.username, "payment", payment);
      emit(user.username, "account", account);

      res.send({ payment });
    });
  })
);

app.post(
  "/checkRedeemCode",
  auth,
  ah(async function(req, res) {
    const { redeemcode } = req.body;

    const payment = await db.Payment.findOne({ where: { redeemcode } });
    res.send(payment);
  })
);

app.post(
  "/password",
  auth,
  ah(async function(req, res) {
    const { user } = req;
    const { password } = req.body;

    if (!user.password) return res.send(true);
    res.send(await bcrypt.compare(password, user.password));
  })
);
