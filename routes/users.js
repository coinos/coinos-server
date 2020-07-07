const axios = require("axios");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const authenticator = require("otplib").authenticator;
const textToImage = require("text-to-image");
const randomWord = require("random-words");

const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});
require("../lib/whitelist");

const twofa = (req, res, next) => {
  let {
    user,
    body: { token },
  } = req;
  if (
    user.twofa &&
    (typeof token === "undefined" ||
      !authenticator.check(token, user.otpsecret))
  ) {
    return res.status(401).send("2fa required");
  } else next();
};

app.get("/users/:username", async (req, res) => {
  const { username } = req.params;
  const user = await db.User.findOne({
    attributes: ["username"],
    where: { username },
  });
  if (user) res.send(user);
  else res.status(500).send("User not found");
});

app.get("/challenge", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  challenge[ip] = randomWord();
  l.info("setting up challenge", ip, challenge[ip]);
  const data = await textToImage.generate(challenge[ip]);
  res.send(data);
});

app.post("/register", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const user = await register(req.body.user, ip, true);
    res.send(pick(user, ...whitelist));
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.post("/disable2fa", auth, twofa, async (req, res) => {
  let { user } = req;
  user.twofa = false;
  await user.save();
  emit(user.username, "user", user);
  emit(user.username, "otpsecret", user.otpsecret);
  l.info("disabled 2fa", user.username);
  res.end();
});

app.get("/otpsecret", auth, twofa, async (req, res) => {
  let { user } = req;
  emit(user.username, "otpsecret", user.otpsecret);
  res.end();
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
      return res.status(500).send("Invalid token");
    }
  } catch (e) {
    l.error("error setting up 2fa", e);
  }

  l.info("enabled 2fa", user.username);
  res.end();
});

app.post("/user", auth, async (req, res) => {
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
      passconfirm,
      tokens,
      seed,
    } = req.body;

    let exists = await db.User.findOne({
      where: { username },
    });

    let token;
    if (user.username !== username && exists) {
      return res.status(500).send("Username taken");
    } else {
      sockets[username] = sockets[user.username];
      user.username = username;

      if (user.address) addresses[user.address] = username;

      if (user.liquid) addresses[user.liquid] = user.username;

      token = jwt.sign({ username }, config.jwt);
      res.cookie("token", token, {
        expires: new Date(Date.now() + 432000000),
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

    if (password && password === passconfirm) {
      user.password = await bcrypt.hash(password, 1);
    }

    await user.save();
    emit(user.username, "user", user);
    res.send({ user, token });
  } catch (e) {
    l.error("error updating user", e.message);
  }
});

app.post("/keys", auth, async (req, res) => {
  const { key: hex } = req.body;
  const key = await db.Key.create({
    user_id: req.user.id,
    hex,
  });
  emit(req.user.username, "key", key);
});

app.post("/keys/delete", auth, async (req, res) => {
  const { hex } = req.body;
  (
    await db.Key.findOne({
      where: {
        user_id: req.user.id,
        hex,
      },
    })
  ).destroy();
});

app.post("/login", async (req, res) => {
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
    "login attempt",
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
    user.keys = await user.getKeys();
    user = pick(user, ...whitelist);
    res.send({ user, token });
  } catch (e) {
    l.error("login error", e.message);
    res.status(401).end();
  }
});

app.post("/logout", auth, async (req, res) => {
  let { subscription } = req.body;
  const { username } = req.user;
  l.info("logging out", username);
  if (!subscription) return res.end();
  let i = req.user.subscriptions.findIndex(
    (s) => JSON.stringify(s) === subscription
  );
  if (i > -1) {
    req.user.subscriptions.splice(i, 1);
  }
  await req.user.save();
  Object.keys(logins).map(
    (k) => logins[k]["username"] === username && delete logins[k]
  );

  res.end();
});

app.post("/address", auth, async (req, res) => {
  if (!config.bitcoin) return res.status(500).send("Bitcoin not configured");

  let { user } = req;
  delete addresses[user.address];

  if (config.bitcoin.walletpass)
    await bc.walletPassphrase(config.bitcoin.walletpass, 300);

  user.address = await bc.getNewAddress("", req.body.type || "bech32");
  await user.save();
  addresses[user.address] = user.username;
  emit(user.username, "user", user);
  res.send(user.address);
});

app.post("/account", auth, async (req, res) => {
  let { user } = req;
  let { asset, precision, name, ticker, user_id } = req.body;

  try {
    const account = await db.Account.findOne({
      where: { user_id, asset },
    });

    account.name = name;
    account.ticker = ticker;
    account.precision = precision;

    await account.save();

    emit(user.username, "account", account);
    res.end();
  } catch (e) {
    l.error(e.message);
    return res.status(500).send("There was a problem updating the account");
  }
});

app.post("/shiftAccount", auth, async (req, res) => {
  let { user } = req;
  let { asset } = req.body;

  try {
    const account = await db.Account.findOne({
      where: { user_id: user.id, asset },
    });

    user.account_id = account.id;
    await user.save();
    let payments = await user.getPayments({
      where: {
        account_id: user.account_id,
      },
      order: [["id", "DESC"]],
      limit: 12,
      include: {
        model: db.Account,
        as: "account",
      },
    });
    user.payments = payments;
    user.account = account;

    emit(user.username, "user", user);
    res.end();
  } catch (e) {
    l.error(e.message);
    return res.status(500).send("There was a problem switching accounts");
  }
});

app.get("/vapidPublicKey", function (req, res) {
  res.send(config.vapid.publicKey);
});

app.post("/subscribe", auth, async function (req, res) {
  let { subscriptions } = req.user;
  let { subscription } = req.body;
  if (!subscriptions) subscriptions = [];
  if (
    !subscriptions.find(
      (s) => JSON.stringify(s) === JSON.stringify(subscription)
    )
  )
    subscriptions.push(subscription);
  req.user.subscriptions = subscriptions;
  l.info("subscribing", req.user.username);
  await req.user.save();
  res.sendStatus(201);
});
