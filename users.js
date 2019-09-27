const { Client } = require("authy-client");
const axios = require("axios");
const bcrypt = require("bcrypt");
const fb = require("fb");
const jwt = require("jsonwebtoken");
const mailgun = require("mailgun-js");
const uuidv4 = require("uuid/v4");

const authyVerify = require("./authy");
const config = require("./config");
const authy = new Client({ key: config.authy.key });
const whitelist = require("./whitelist");

const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});

module.exports = (addresses, auth, app, bc, db, emit) => {
  app.post("/register", async (req, res) => {
    let err = m => res.status(500).send(m);
    let user = req.body;
    if (!user.username) return err("Username required");
    if (user.password.length < 2) return err("Password too short");

    let exists = await db.User.count({ where: { username: user.username } });
    if (exists) return err("Username taken");

    user.address = await bc.getNewAddress("", "bech32");
    user.password = await bcrypt.hash(user.password, 1);
    user.name = user.username;
    addresses[user.address] = user.username;

    await db.User.create(user);
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
      html: `Visit <a href="https://coinos.io/verifyEmail/${user.username}/${
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

  app.post("/user", auth, async (req, res) => {
    let { user } = req;
    let {
      email,
      phone,
      twofa,
      pin,
      pinconfirm,
      password,
      passconfirm
    } = req.body;

    if (user.email !== email && require("email-validator").validate(email)) {
      user.email = email;
      user.emailVerified = false;
      requestEmail(user);
    }

    if (user.phone !== phone) {
      user.phone = phone;
      user.phoneVerified = false;
      requestPhone(user);
    }

    user.email = email;
    user.phone = phone;
    user.twofa = twofa;

    if (password && password === passconfirm) {
      user.password = await bcrypt.hash(password, 1);
    }

    if (pin && pin === pinconfirm) user.pin = await bcrypt.hash(pin, 1);

    if (twofa && !user.authyId && user.phoneVerified) {
      try {
        let r = await authy.registerUser({ countryCode: "CA", email, phone });
        user.authyId = r.user.id;
      } catch (e) {
        l(e);
      }
    }

    await user.save();
    emit(req.user.username, "user", req.user);
    res.send(user);
  });

  app.post("/forgot", async (req, res) => {
    let { user } = req;
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
  });

  app.get("/verifyEmail/:username/:token", auth, async (req, res) => {
    let user = await db.User.findOne({
      where: {
        username: req.params.username,
        emailToken: req.params.token
      }
    });

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
    try {
      let user = await db.User.findOne({
        where: {
          username: req.body.username
        }
      });

      if (
        !user ||
        !(await bcrypt.compare(req.body.password, user.password)) ||
        (user.twofa && !(await authyVerify(user)))
      ) {
        return res.status(401).end();
      }

      let payload = { username: user.username };
      let token = jwt.sign(payload, config.jwt);
      res.cookie("token", token, { expires: new Date(Date.now() + 432000000) });

      user = pick(user, ...whitelist);
      res.send({ user, token });
    } catch (err) {
      console.log(err);
      res.status(401).end();
    }
  });

  app.post("/facebookLogin", async (req, res) => {
    let { accessToken, userID } = req.body;

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
        user.name = (await fb.api(`/me?access_token=${accessToken}`)).name;
        user.address = await bc.getNewAddress("", "bech32");
        user.password = await bcrypt.hash(accessToken, 1);
        user.balance = 0;
        user.pending = 0;
        let friends = (await fb.api(
          `/${userID}/friends?access_token=${accessToken}`
        )).data;
        if (friends.find(f => f.id === config.facebook.specialFriend)) {
          user.friend = true;
          user.limit = 200;
        }
        await user.save();
        addresses[user.address] = user.username;
      }

      user.pic = (await fb.api(
        `/me/picture?access_token=${accessToken}&redirect=false`
      )).data.url;
      user.fbtoken = accessToken;
      await user.save();

      if (user.twofa && !(await authyVerify(user))) res.status(401).end();

      let payload = { username: user.username };
      let token = jwt.sign(payload, config.jwt);
      res.cookie("token", token, { expires: new Date(Date.now() + 432000000) });
      res.send({ user, token });
    } catch (err) {
      l(err);
      res.status(401).end();
    }
  });

  app.get("/me", async (req, res) => {
    let data = (await fb.api(
      "/me/picture?access_token=EAAEIFqWk3ZAwBAEUfxQdH3T5CBKXmU8d7jQ5OTJBJZBiU1ZAp76lO26nh57WolM4R4JoKks9BCc49s8VrlEm2Ub1GlZCEzVD9fGxzUiranXDErDmR5gDUPKX3BhCsGA649a4hmbldRwKFTsmZCGZCergm9ACspKdTZB0WgFgA9wEdemIRIXuwCygNrymmKDh0Wd8nmoT4Hj3wZDZD&redirect=false"
    )).data;
    res.send(data.url);
  });

  app.get("/friends", auth, async (req, res) => {
    try {
      let friends = (await fb.api(
        `/${req.user.username}/friends?access_token=${req.user.fbtoken}`
      )).data;
      friends = await Promise.all(
        friends.map(async f => {
          let pic = (await fb.api(
            `/${f.id}/picture?redirect=false&type=small&access_token=${
              req.user.fbtoken
            }`
          )).data;
          f.pic = pic.url;
          return f;
        })
      );

      res.send(friends);
    } catch (e) {
      res
        .status(500)
        .send("There was a problem getting your facebook friends: ", e);
    }
  });
};
