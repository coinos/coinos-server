const axios = require("axios");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mailgun = require("mailgun-js");
const uuidv4 = require("uuid/v4");
const BitcoinCore = require("bitcoin-core");
const config = require("./config");
const whitelist = require("./whitelist");
const fb = "https://graph.facebook.com/";
const liquid = new BitcoinCore(config.liquid);
const Sequelize = require("sequelize");
const authenticator = require("otplib").authenticator;

const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});
const l = console.log;
let faucet = 1000;
const DAY = 24 * 60 * 60 * 1000;

const twofa = (req, res, next) => {
  let {
    user,
    body: { token }
  } = req;
  if (!user.twofa || authenticator.check(token, user.otpsecret)) next(req, res);
  else res.status(401).send("2fa required");
};

module.exports = (addresses, auth, app, bc, db, emit) => {
  app.get("/liquidate", async (req, res) => {
    let users = await db.User.findAll();
    for (let i = 0; i < users.length; i++) {
      let user = users[i];
      if (!user.confidential) {
        user.confidential = await liquid.getNewAddress();
        user.liquid = (await liquid.getAddressInfo(
          user.confidential
        )).unconfidential;
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
    user.confidential = await liquid.getNewAddress();
    user.liquid = (await liquid.getAddressInfo(
      user.confidential
    )).unconfidential;
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

    if (ip.startsWith('127') || ip.startsWith('192')) user.currency = "CAD";
    else { 
      let info = await axios.get(`http://api.ipstack.com/${ip}?access_key=${config.ipstack}`);
      user.currency = countries[info.data.country_code] || "USD";
    }

    user.currencies = [user.currency];
    user.otpsecret = authenticator.generateSecret();

    addresses[user.address] = user.username;
    addresses[user.liquid] = user.username;
    user = await db.User.create(user);
    await gift(user);

    res.send(pick(user, ...whitelist));
  });

  const requestEmail = async user => {
    user.emailToken = uuidv4();
    await user.save();

    let mg = mailgun(config.mailgun);
    let msg = {
      from: "CoinOS <webmaster@coinos.io>",
      to: user.email,
      subject: "CoinOS Email Verification",
      html: `Visit <a href="https://coinos.io/verify/${user.username}/${
        user.emailToken
      }">https://coinos.io/verify/${user.username}/${
        user.emailToken
      }</a> to verify your email address.`
    };

    try {
      mg.messages().send(msg);
    } catch (e) {
      l(e);
    }
  };

  const requestPhone = async user => {
    user.phoneToken = Math.floor(100000 + Math.random() * 900000);
    await user.save();
    const client = require("twilio")(
      config.twilio.sid,
      config.twilio.authToken
    );

    await client.messages.create({
      body: user.phoneToken,
      from: config.twilio.number,
      to: user.phone
    });
  };

  app.post("/requestEmail", auth, async (req, res) => {
    req.user.email = req.body.email;
    await requestEmail(req.user);
    res.end();
  });

  app.post("/requestPhone", auth, async (req, res) => {
    req.user.phone = req.body.phone;
    await requestPhone(req.user);
    res.end();
  });

  app.post("/disable2fa", auth, twofa, async (req, res) => {
    let { user } = req;
    user.twofa = false;
    await user.save();
    emit(user.username, "user", user);
    emit(user.username, "otpsecret", user.otpsecret);
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
      l(e);
    }
    res.end();
  });

  app.post("/user", auth, async (req, res) => {
    try {
      let { user } = req;
      let {
        username,
        currency,
        currencies,
        email,
        phone,
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
        user.username = username;
        addresses[user.address] = username;
        addresses[user.liquid] = user.username;
        token = jwt.sign({ username }, config.jwt);
        res.cookie("token", token, {
          expires: new Date(Date.now() + 432000000)
        });
      }

      if (email && user.email !== email) {
        if (!require("email-validator").validate(email)) {
          return res.status(500).send("invalid email");
        }

        user.email = email;
        user.emailVerified = false;
        requestEmail(user);
      }

      if (user.phone !== phone) {
        user.phone = phone;
        user.phoneVerified = false;
        requestPhone(user);
      }

      user.currencies = currencies;
      user.currency = currency;
      if (currencies.length) {
        if (!currencies.includes(currency)) user.currency = currencies[0];
      } else {
        user.currency = null;
      }

      user.email = email;
      user.phone = phone;
      user.twofa = twofa;
      user.pin = pin;

      if (password && password === passconfirm) {
        user.password = await bcrypt.hash(password, 1);
      }

      await user.save();
      emit(user.username, "user", req.user);
      res.send({ user, token });
    } catch (e) {
      l(e);
    }
  });

  app.post("/forgot", async (req, res) => {
    let user = await db.User.findOne({
      where: {
        email: req.body.email
      }
    });

    if (user) {
      let mg = mailgun(config.mailgun);
      let msg = {
        from: "CoinOS <webmaster@coinos.io>",
        to: user.email,
        subject: "CoinOS Password Reset",
        html: `Visit <a href="https://coinos.io/reset/${user.username}/${
          user.token
        }">https://coinos.io/reset/${user.username}/${
          user.token
        }</a> to reset your password.`
      };

      try {
        mg.messages().send(msg);
      } catch (e) {
        l(e);
      }
    }

    res.end();
  });

  app.get("/verifyEmail/:username/:token", auth, async (req, res) => {
    let user = await db.User.findOne({
      where: {
        username: req.params.username,
        emailToken: req.params.token
      }
    });

    user.emailToken = uuidv4();

    if (user) {
      user.emailVerified = true;
      await user.save();

      emit(user.username, "user", user);
      emit(user.username, "emailVerified", true);

      res.end();
    } else {
      res.status(500).send("invalid token or username");
    }
  });

  app.get("/verifyPhone/:username/:token", auth, async (req, res) => {
    let user = await db.User.findOne({
      where: {
        username: req.params.username,
        phoneToken: req.params.token
      }
    });

    if (user) {
      user.phoneVerified = true;
      await user.save();

      emit(user.username, "user", user);
      emit(user.username, "phoneVerified", true);
      res.end();
    } else {
      res.status(500).send("invalid token or username");
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
        return res.status(401).end();
      }

      if (user.twofa && (typeof twofa === "undefined" || !authenticator.check(twofa, user.otpsecret)))
        return res.status(401).send("2fa required");

      let payload = { username: user.username };
      let token = jwt.sign(payload, config.jwt);
      res.cookie("token", token, { expires: new Date(Date.now() + 432000000) });

      user = pick(user, ...whitelist);
      res.send({ user, token });
    } catch (err) {
      l(err);
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
        user.confidential = await liquid.getNewAddress();
        user.liquid = (await liquid.getAddressInfo(
          user.confidential
        )).unconfidential;
        user.password = await bcrypt.hash(accessToken, 1);
        user.balance = 0;
        user.pending = 0;
        let friends = (await axios.get(
          `${fb}/${userID}/friends?access_token=${accessToken}`
        )).data.data;
        if (friends.find(f => f.id === config.facebook.specialFriend)) {
          user.friend = true;
          user.limit = 200;
        }
        await user.save();
        addresses[user.address] = user.username;
        addresses[user.liquid] = user.username;
        await gift(user);
      }

      if (user.twofa && (typeof twofa === "undefined" || !authenticator.check(twofa, user.otpsecret)))
        return res.status(401).send("2fa required");

      user.pic = (await axios.get(
        `${fb}/me/picture?access_token=${accessToken}&redirect=false`
      )).data.data.url;
      user.fbtoken = accessToken;
      await user.save();

      let payload = { username: user.username };
      let token = jwt.sign(payload, config.jwt);
      res.cookie("token", token , { expires: new Date(Date.now() + 432000000) });
      res.send({ user, token });
    } catch (err) {
      l(err);
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
};
