const axios = require("axios");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const authenticator = require("otplib").authenticator;

const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});
let faucet = 1000;
const DAY = 24 * 60 * 60 * 1000;
require("../lib/whitelist");

const twofa = (req, res, next) => {
  let {
    user,
    body: { token }
  } = req;
  if (
    user.twofa &&
    (typeof twofa === "undefined" ||
      !authenticator.check(twofa, user.otpsecret))
  ) {
    return res.status(401).send("2fa required");
  } else next();
};

const gift = async user => {
  const account = user.accounts[0];

  if (faucet > 0) {
    faucet -= 100;

    account.balance = 100;
    await account.save();

    const payment = await db.Payment.create({
      account_id: account.id,
      user_id: user.id,
      hash: "Welcome Gift",
      amount: 100,
      currency: user.currency,
      rate: app.get("rates")[user.currency],
      received: true,
      confirmed: 1,
      network: "GIFT"
    });

    await user.save();
  }
};

app.get("/users/:username", async (req, res) => {
  const { username } = req.params;
  const user = await db.User.findOne({
    attributes: ["username"],
    where: { username }
  });
  if (user) res.send(user);
  else res.status(500).send("User not found");
});

app.post("/register", async (req, res) => {
  let err = m => res.status(500).send(m);
  let user = req.body;
  let { token } = user;
  if (!user.username) return err("Username required");

  l.info("registering user");
  let exists = await db.User.count({ where: { username: user.username } });
  if (exists) return err("Username taken");

  l.info("setting bitcoin addresses");
  if (config.bitcoin) {
    if (config.bitcoin.walletpass)
      await bc.walletPassphrase(config.bitcoin.walletpass, 300);

    user.address = await bc.getNewAddress("", "bech32");
    addresses[user.address] = user.username;
  }

  l.info("setting liquid addresses");
  if (config.liquid) {
    if (config.liquid.walletpass)
      await lq.walletPassphrase(config.liquid.walletpass, 300);

    user.confidential = await lq.getNewAddress();
    user.liquid = (await lq.getAddressInfo(user.confidential)).unconfidential;
    addresses[user.liquid] = user.username;
  }

  let ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;

  let success, score;
  if (process.env.NODE_ENV === "production") {
    l.info("checking captcha");
    if (!token) return res.status(500).send("Missing captcha token");

    try {
      const url = `https://www.google.com/recaptcha/api/siteverify?secret=${config.captcha}&response=${token}&remoteip=${ip}`;
      let captcha = await axios.post(url, { timeout: 1000 });

      ({ success, score } = captcha.data);

      if (!success || score < 0.3) {
        l.warn("failed registration attempt", ip);

        if (ip !== "192.168.1.5") {
          const spawn = require("child_process").spawn;
          proc = spawn("iptables", ["-I", "INPUT", "-s", ip, "-j", "DROP"]);
        }

        return res.status(500).send("Failed captcha");
      }
    } catch (e) {
      l.error(e.message);
    }
  }

  let countries = {
    CA: "CAD",
    US: "USD",
    JP: "JPY",
    CN: "CNY",
    AU: "AUD",
    GB: "GBP"
  };

  if (!config.ipstack || ip.startsWith("127") || ip.startsWith("192"))
    user.currency = "CAD";
  else {
    let info = await axios.get(
      `http://api.ipstack.com/${ip}?access_key=${config.ipstack}`
    );
    user.currency = countries[info.data.country_code] || "USD";
  }

  user.currencies = [...new Set([user.currency, "CAD", "USD", "JPY"])];
  user.otpsecret = authenticator.generateSecret();

  user = await db.User.create(user);

  let account = await db.Account.create({
    user_id: user.id,
    asset: config.liquid.btcasset,
    balance: 0,
    pending: 0,
    name: "Bitcoin",
    ticker: "BTC",
    precision: 8
  });

  user.accounts = [account];

  const d = ip.split(".");
  const numericIp = ((+d[0] * 256 + +d[1]) * 256 + +d[2]) * 256 + +d[3];
  user.ip = numericIp;
  const ipExists = await db.User.findOne({ where: { ip: numericIp } });
  if (!ipExists) await gift(user);

  user.account_id = account.id;
  await user.save();
  user = await getUser(user.username);
  res.send(pick(user, ...whitelist));
  emit(user.username, "user", user);
  l.info("new user", user.username, ip, score);
});

app.post("/disable2fa", auth, twofa, async (req, res) => {
  let { user } = req;
  user.twofa = false;
  await user.save();
  user = await getUser(user.username);
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
      user = await getUser(user.username);
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
      unit,
      currency,
      currencies,
      twofa,
      pin,
      password,
      passconfirm
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

      if (user.address) addresses[user.address] = username;

      if (user.liquid) addresses[user.liquid] = user.username;

      token = jwt.sign({ username }, config.jwt);
      res.cookie("token", token, {
        expires: new Date(Date.now() + 432000000)
      });
    }

    if (unit) user.unit = unit;
    user.currency = currency;
    user.currencies = currencies;

    user.twofa = twofa;
    user.pin = pin;

    if (password && password === passconfirm) {
      user.password = await bcrypt.hash(password, 1);
    }

    await user.save();
    user = await getUser(user.username);
    emit(user.username, "user", user);
    res.send({ user, token });
  } catch (e) {
    l.error("error updating user", e);
  }
});

app.post("/login", async (req, res) => {
  let twofa = req.body.token;

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

    user = pick(user, ...whitelist);
    res.send({ user, token });
  } catch (e) {
    l.error("login error", e.message);
    res.status(401).end();
  }
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
  user = await getUser(user.username);
  emit(user.username, "user", user);
  res.send(user.address);
});

app.post("/account", auth, async (req, res) => {
  let { user } = req;
  let { asset, precision, name, ticker, user_id } = req.body;

  try {
    const account = await db.Account.findOne({
      where: { user_id, asset }
    });

    account.name = name;
    account.ticker = ticker;
    account.precision = precision;

    await account.save();

    user = await getUser(user.username);
    emit(user.username, "user", user);
    res.send(account);
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
      where: { user_id: user.id, asset }
    });

    user.account_id = account.id;
    await user.save();

    user = await getUser(user.username);
    emit(user.username, "user", user);
    res.send(account);
  } catch (e) {
    l.error(e.message);
    return res.status(500).send("There was a problem switching accounts");
  }
});

setInterval(() => (faucet = 2000), DAY);
