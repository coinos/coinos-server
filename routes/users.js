import app from "$app";
import redis from "$lib/redis";
import config from "$config";
import store from "$lib/store";
import { auth, optionalAuth } from "$lib/passport";
import { getUser, nada, uniq, wait } from "$lib/utils";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import whitelist from "$lib/whitelist";
import { l, err, warn } from "$lib/logging";
import { emit } from "$lib/sockets";
import register from "$lib/register";
import { requirePin } from "$lib/utils";
import got from "got";
import { bech32 } from "bech32";

const { encode, decode, fromWords, toWords } = bech32;

const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});

app.get("/me", auth, async (req, res) => {
  try {
    let user = req.user.get({ plain: true });
    user.haspin = !!user.pin;
    res.send(pick(user, ...whitelist));
  } catch (e) {
    console.log("problem fetching user", e);
    res.code(500).send(e.message);
  }
});

app.get("/users/:key", async (req, res) => {
  try {
    if (key.startsWith("npub")) {
      key = Buffer.from(fromWords(decode(key).words)).toString("hex");
    }

    user = JSON.parse(await redis.get(`user:${key}`));

    if (!user && key.length === 64) {
      user = {
        username: key.substr(0, 6),
        pubkey: key,
        anon: true
      };
    }

    if (!user) return res.code(500).send("User not found");

    let whitelist = [
      "username",
      "banner",
      "profile",
      "address",
      "currency",
      "pubkey",
      "display",
      "prompt",
      "uuid"
    ];

    res.send(pick(user, ...whitelist));
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

app.get("/invoices", auth, async function(req, res) {
  let invoices = await db.Invoice.findAll({
    where: { user_id: req.user.id }
  });
  res.send(invoices);
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
        attributes: ["username", "profile", "uuid"],
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
