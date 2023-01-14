import app from "$app";
import { g, s } from "$lib/redis";
import config from "$config";
import store from "$lib/store";
import { auth, optionalAuth } from "$lib/passport";
import { nada, pick, uniq, wait } from "$lib/utils";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import whitelist from "$lib/whitelist";
import { l, err, warn } from "$lib/logging";
import { emit } from "$lib/sockets";
import register from "$lib/register";
import { requirePin } from "$lib/utils";
import got from "got";

app.get("/me", auth, async (req, res) => {
  try {
    res.send(pick(req.user, whitelist));
  } catch (e) {
    console.log("problem fetching user", e);
    res.code(500).send(e.message);
  }
});

app.get("/users/:key", async ({ params: { key } }, res) => {
  try {
    if (key.startsWith("npub")) {
      key = Buffer.from(fromWords(decode(key).words)).toString("hex");
    }

    let user = await g(`user:${key}`);
    if (typeof user === "string") {
      user = await g(`user:${user}`);
    }

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
      "id"
    ];

    res.send(pick(user, whitelist));
  } catch (e) {
    console.log(e);
    res.code(500).send(e.message);
  }
});

app.post("/register", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
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
    res.send(pick(user, whitelist));
  } catch (e) {
    res.code(500).send(e.message);
  }
});

app.post("/disable2fa", auth, async ({ user, body: { token } }, res) => {
  let { id, twofa, username, otpsecret } = user;
  if (twofa && !authenticator.check(token, otpsecret)) {
    return res.code(401).send("2fa required");
  }

  user.twofa = false;
  await s(`user:${id}`, user);
  emit(username, "user", user);
  emit(username, "otpsecret", user.otpsecret);
  l("disabled 2fa", username);
  res.send({});
});

app.post("/2fa", auth, async ({ user, body: { token } }, res) => {
  let { id, otpsecret, username } = user;
  const isValid = authenticator.check(token, otpsecret);
  if (isValid) {
    user.twofa = true;
    await s(`user:${id}`, user);
    emit(username, "user", user);
  } else {
    return res.code(500).send("Invalid token");
  }

  l("enabled 2fa", username);
  res.send({});
});

app.post("/user", auth, async ({ user, body: { confirm, password, pin, newpin, username }}, res) => {
  try {
    let { user } = req;

    l("updating user", user.username);

    if (user.pin && !(pin === user.pin)) throw new Error("Pin required");
    if (typeof newpin !== "undefined") user.pin = newpin;
    if (!user.pin) user.pin = null;

    let exists;
    if (username) exists = await g(`user:${username}`);

    let token;
    if (user.username !== username && exists) {
      err("username taken", username, user.username, exists.username);
      throw new Error("Username taken");
    } else if (username) {
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

let login = async (req, res) => {
  try {
    const { params, sig, key, password, username, token: twofa } = req.body;
    l("logging in", username);

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

    let id = await g(`user:${username}`);
    let user = await g(`user:${id}`);

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
      req.headers["x-forwarded-for"] || req.socket.remoteAddress
    );

    let payload = { username, id: user.id };
    let token = jwt.sign(payload, config.jwt);
    res.cookie("token", token, { expires: new Date(Date.now() + 432000000) });
    user = pick(user, whitelist);
    res.send({ user, token });
  } catch (e) {
    console.log(e);
    err("login error", e.message, req.socket.remoteAddress);
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

app.get("/contacts", auth, async function({ user: { uuid } }, res) {
  let payments = (await g(`${uuid}:payments`)) || [];
  res.send(
    Promise.all(
      [...new Set(payments.map(p => p.with_id))].map(id => g(`user:${id}`))
    )
  );
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
