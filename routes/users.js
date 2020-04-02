const axios = require("axios");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const uuidv4 = require("uuid/v4");
const fb = "https://graph.facebook.com/";
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

app.get("/liquidate", async (req, res) => {
  let users = await db.User.findAll();
  for (let i = 0; i < users.length; i++) {
    let user = users[i];
    if (!user.confidential) {
      user.confidential = await lq.getNewAddress();
      user.liquid = (await lq.getAddressInfo(user.confidential)).unconfidential;
      await user.save();
    }

    if (!user.otpsecret) {
      user.otpsecret = authenticator.generateSecret();
      await user.save();
    }
  }
  res.end();
});

const gift = async user => {
  if (faucet > 0) {
    user.balance = 100;
    faucet -= 100;
    const payment = await db.Payment.create({
      user_id: user.id,
      hash: "Welcome Gift",
      amount: 100,
      currency: user.currency,
      rate: app.get("rates")[user.currency],
      received: true,
      confirmed: 1,
      asset: "GIFT"
    });
    await user.save();
  }
};

app.post("/register", async (req, res) => {
  let err = m => res.status(500).send(m);
  let user = req.body;
  if (!user.username) return err("Username required");

  let exists = await db.User.count({ where: { username: user.username } });
  if (exists) return err("Username taken");

  user.address = await bc.getNewAddress("", "bech32");
  user.confidential = await lq.getNewAddress();
  user.liquid = (await lq.getAddressInfo(user.confidential)).unconfidential;
  user.name = user.username;
  let ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  let countries = {
    CA: "CAD",
    US: "USD",
    JP: "JPY",
    CN: "CNY",
    AU: "AUD",
    GB: "GBP"
  };

  if (!config.ipstack || ip.startsWith("127") || ip.startsWith("192")) user.currency = "CAD";
  else {
    let info = await axios.get(
      `http://api.ipstack.com/${ip}?access_key=${config.ipstack}`
    );
    user.currency = countries[info.data.country_code] || "USD";
  }

  user.currencies = [user.currency];
  user.otpsecret = authenticator.generateSecret();

  addresses[user.address] = user.username;
  addresses[user.liquid] = user.username;
  user = await db.User.create(user);
  await gift(user);

  l.info("new user", user.username);
  res.send(pick(user, ...whitelist));
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
      sids[username] = sids[user.username];
      user.username = username;
      addresses[user.address] = username;
      addresses[user.liquid] = user.username;
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
    emit(user.username, "user", req.user);
    res.send({ user, token });
  } catch (e) {
    l.error("error updating user", e);
  }
});

app.post("/login", async (req, res) => {
  let twofa = req.body.token;

  try {
    let user = await db.User.findOne({
      where: {
        username: req.body.username
      }
    });

    if (
      !user ||
      (user.password &&
        !(await bcrypt.compare(req.body.password, user.password)))
    ) {
      l.warn("invalid username or password attempt");
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
    l.error("login error", e);
    res.status(401).end();
  }
});

app.post("/facebookLogin", async (req, res) => {
  let { accessToken, userID } = req.body;
  let twofa = req.body.token;

  let url = `https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${
    config.facebook.appToken
  }`;
  let check = await axios.get(url);
  if (!check.data.data.is_valid) return res.status(401).end();

  try {
    let user = await db.User.findOne({
      where: {
        username: req.body.userID
      }
    });

    if (!user) {
      user = await db.User.create(user);
      user.username = userID;
      user.name = (await axios.get(
        `${fb}/me?access_token=${accessToken}`
      )).data.name;
      user.address = await bc.getNewAddress("", "bech32");
      user.confidential = await lq.getNewAddress();
      user.liquid = (await lq.getAddressInfo(user.confidential)).unconfidential;
      user.password = await bcrypt.hash(accessToken, 1);
      user.balance = 0;
      user.pending = 0;
      let friends = (await axios.get(
        `${fb}/${userID}/friends?access_token=${accessToken}`
      )).data.data;
      await user.save();
      addresses[user.address] = user.username;
      addresses[user.liquid] = user.username;
      await gift(user);
      l.info("new facebook user", user.name);
    }

    if (
      user.twofa &&
      (typeof twofa === "undefined" ||
        !authenticator.check(twofa, user.otpsecret))
    )
      return res.status(401).send("2fa required");

    user.pic = (await axios.get(
      `${fb}/me/picture?access_token=${accessToken}&redirect=false`
    )).data.data.url;
    user.fbtoken = accessToken;
    await user.save();

    let payload = { username: user.username };
    let token = jwt.sign(payload, config.jwt);
    res.cookie("token", token, { expires: new Date(Date.now() + 432000000) });
    res.send({ user, token });
  } catch (e) {
    l.error("error during facebook login", e);
    res.status(401).end();
  }
});

app.get("/me", async (req, res) => {
  let {
    data: {
      data: { url }
    }
  } = await axios.get(
    `${fb}/me/picture?access_token=EAAEIFqWk3ZAwBAEUfxQdH3T5CBKXmU8d7jQ5OTJBJZBiU1ZAp76lO26nh57WolM4R4JoKks9BCc49s8VrlEm2Ub1GlZCEzVD9fGxzUiranXDErDmR5gDUPKX3BhCsGA649a4hmbldRwKFTsmZCGZCergm9ACspKdTZB0WgFgA9wEdemIRIXuwCygNrymmKDh0Wd8nmoT4Hj3wZDZD&redirect=false`
  );
  res.send(url);
});

app.get("/friends", auth, async (req, res) => {
  try {
    const {
      data: { data }
    } = await axios.get(
      `${fb}/${req.user.username}/friends?access_token=${req.user.fbtoken}`
    );

    const friends = await Promise.all(
      data.map(async f => {
        f.pic = (await axios.get(
          `${fb}/${f.id}/picture?redirect=false&type=small&access_token=${
            req.user.fbtoken
          }`
        )).data.data.url;
        return f;
      })
    );

    res.send(friends);
  } catch (e) {
    res
      .status(500)
      .send("There was a problem getting your facebook friends: " + e);
  }
});

setInterval(() => (faucet = 2000), DAY);
