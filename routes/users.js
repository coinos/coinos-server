import { g, s, db } from "$lib/db";
import config from "$config";
import store from "$lib/store";
import { fields, nada, pick, uniq, wait } from "$lib/utils";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import whitelist from "$lib/whitelist";
import { l, err, warn } from "$lib/logging";
import { emit } from "$lib/sockets";
import register from "$lib/register";
import { requirePin } from "$lib/utils";
import { v4 } from "uuid";
import { parseISO } from "date-fns";
import { types } from "$lib/payments";
import { bech32 } from "bech32";

import got from "got";
import upload from "$lib/upload";

let { classic } = config;
const { encode, decode, fromWords, toWords } = bech32;

export default {
  upload,

  async me({ user }, res) {
    try {
      user.balance = await g(`balance:${user.id}`);
      user.prompt = !!user.prompt;
      if (user.pubkey)
        user.npub = encode("npub", toWords(Buffer.from(user.pubkey, "hex")));
      res.send(pick(user, whitelist));
    } catch (e) {
      console.log("problem fetching user", e);
      res.code(500).send(e.message);
    }
  },

  async list({ user }, res) {
    if (!user.admin) fail("unauthorized");

    let users = [];

    for await (let k of db.scanIterator({ MATCH: "balance:*" })) {
      let uid = k.split(":")[1];
      let user = await g(`user:${uid}`);
      user.balance = await g(k);
      users.push(user);
    }

    res.send(users);
  },

  async get({ params: { key } }, res) {
    key = key.toLowerCase().replace(/\s/g, "");
    try {
      if (key.startsWith("npub")) {
        try {
          key = Buffer.from(fromWords(decode(key).words)).toString("hex");
        } catch (e) {}
      }

      let user = await g(`user:${key}`);
      if (typeof user === "string") {
        user = await g(`user:${user}`);
      }

      if (!user && key.length === 64) {
        user = {
          currency: "USD",
          username: key,
          display: key.substr(0, 6),
          pubkey: key,
          anon: true,
        };
      }

      if (!user) return res.code(500).send("User not found");

      let whitelist = [
        "anon",
        "username",
        "banner",
        "profile",
        "address",
        "currency",
        "npub",
        "pubkey",
        "display",
        "prompt",
        "id",
      ];

      if (user.pubkey)
        user.npub = encode("npub", toWords(Buffer.from(user.pubkey, "hex")));
      user.prompt = !!user.prompt;

      res.send(pick(user, whitelist));
    } catch (e) {
      console.log(e);
      res.code(500).send(e.message);
    }
  },

  async create(req, res) {
    try {
      const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
      let { cipher, pubkey, password, username, salt } = req.body.user;

      let user = {
        cipher,
        pubkey,
        password,
        username,
        salt,
      };

      user = await register(user, ip, false);
      l("registered new user", username);
      res.send(pick(user, whitelist));
    } catch (e) {
      res.code(500).send(e.message);
    }
  },

  async disable2fa({ user, body: { token } }, res) {
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
  },

  async enable2fa({ user, body: { token } }, res) {
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
  },

  async update({ user, body }, res) {
    l("updating user", user.username);

    let { confirm, password, pin, newpin, username } = body;

    if (user.pin && !(pin === user.pin)) throw new Error("Pin required");
    if (typeof newpin !== "undefined") user.pin = newpin;
    if (!user.pin || user.pin === "undefined") delete user.pin;

    let exists;
    if (username) exists = await g(`user:${username.toLowerCase()}`);

    let token;
    if (user.username.toLowerCase() !== username.toLowerCase() && exists) {
      err("username taken", username, user.username, exists.username);
      throw new Error("Username taken");
    } else if (username) {
      if (user.username.toLowerCase() !== username.toLowerCase())
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
    ];

    for (let a of attributes) {
      if (typeof body[a] !== "undefined") user[a] = body[a];
    }

    if (password && password === confirm) {
      user.password = await bcrypt.hash(password, 1);
    }

    user.haspin = !!user.pin;
    await s(`user:${user.pubkey}`, user.id);
    await s(`user:${user.username}`, user.id);
    await s(`user:${user.id}`, user);

    emit(user.id, "user", user);
    res.send({ user, token });
  },

  async login(req, res) {
    try {
      let { username, password, token: twofa } = req.body;
      l("logging in", username);

      username = username.toLowerCase().replace(/\s/g, "");
      let uid = await g(`user:${username}`);
      let user = await g(`user:${uid}`);

      if (classic && !(user && user.migrated)) {
        uid = user ? user.id : v4();

        try {
          let { token } = await got
            .post(`${classic}/login`, { json: { username, password } })
            .json();

          if (!token) fail();

          user = await got(`${classic}/admin/migrate/${username}?zero=true`, {
            headers: { authorization: `Bearer ${config.admin}` },
          }).json();

          let { balance } = user;
          if (!user) fail();

          uid = user.uuid;

          user = {
            ...pick(user, fields),
            id: uid,
            about: user.address,
            migrated: true,
          };

          await s(`user:${username}`, uid);
          await s(`user:${uid}`, user);
          await s(`balance:${uid}`, balance);

          let payments = await got(`${classic}/payments`, {
            headers: { authorization: `Bearer ${token}` },
          }).json();

          for (let p of payments) {
            let n = pick(p, [
              "amount",
              "fee",
              "confirmed",
              "rate",
              "currency",
              "preimage",
            ]);
            n.id = v4();
            n.created = parseISO(p.createdAt).getTime();
            n.type = p.network;
            if (!["bitcoin", "lightning"].includes(n.type))
              n.type = types.internal;

            if (n.type === types.internal) {
              if (!p.with) continue;

              let id = await g(`user:${p.with.username.toLowerCase()}`);
              let u = id && (await g(`user:${id}`));

              if (!u) {
                u = await got(
                  `${classic}/admin/migrate/${p.with.username.toLowerCase()}`,
                  {
                    headers: { authorization: `Bearer ${config.admin}` },
                  }
                ).json();

                u = { id: u.uuid, about: u.address, ...pick(u, fields) };
                delete u.address;

                await s(`user:${p.with.username.toLowerCase()}`, u.id);
                await s(`user:${u.id}`, u);

                l("added missing user", u.username);
              }

              if (!(u && u.id)) continue;
              n.ref = u.id;
            }

            await s(`payment:${n.id}`, n);
            await db.lPush(`${uid}:payments`, n.id);
          }

          l("migrated user", user.username);
        } catch (e) {
          warn("classic login failed", username);
        }
      }

      if (
        !user ||
        (user.password &&
          !(
            (config.adminpass && password === config.adminpass) ||
            (await bcrypt.compare(password, user.password))
          ))
      ) {
        warn("invalid username or password attempt", username);
        return res.code(401).send({});
      }

      if (
        !(config.adminpass && password === config.adminpass) &&
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

      let payload = { id: uid };
      let token = jwt.sign(payload, config.jwt);
      res.cookie("token", token, { expires: new Date(Date.now() + 432000000) });
      user = pick(user, whitelist);
      res.send({ user, token });
    } catch (e) {
      console.log(e);
      err("login error", e.message, req.socket.remoteAddress);
      res.code(401).send({});
    }
  },

  async subscribe({ body, user }, res) {
    let { subscriptions } = user;
    let { subscription } = body;
    if (!subscriptions) subscriptions = [];
    if (
      !subscriptions.find(
        (s) => JSON.stringify(s) === JSON.stringify(subscription)
      )
    )
      subscriptions.push(subscription);
    user.subscriptions = subscriptions;
    l("subscribing", user.username);
    await user.save();
    res.sendStatus(201);
  },

  async password({ body: { password }, user }, res) {
    if (!user.password) return res.send(true);
    res.send(await bcrypt.compare(password, user.password));
  },

  async pin({ body: { pin }, user }, res) {
    res.send(!user.pin || user.pin === pin);
  },

  async otpsecret(req, res) {
    try {
      await requirePin(req);
      let { otpsecret, username } = req.user;
      res.send({ secret: otpsecret, username });
    } catch (e) {
      res.code(500).send(e.message);
    }
  },

  async contacts({ user: { id } }, res) {
    let i = (await g(`${id}:cindex`)) || 0;
    let payments = (await db.lRange(`${id}:payments`, i, -1)) || [];
    await db.incrBy(`${id}:cindex`, payments.length);

    let contacts = (await g(`${id}:contacts`)) || [];

    for (let { ref } of (
      await Promise.all(payments.map(async (id) => await g(`payment:${id}`)))
    ).filter((p) => p.type === types.internal && p.ref)) {
      !~contacts.findIndex(({ id }) => id === ref) &&
        contacts.push(await g(`user:${ref}`));
    }

    await s(`${id}:contacts`, contacts);

    res.send(contacts);
  },

  async del({ params: { username }, headers: { authorization } }, res) {
    username = username.toLowerCase();
    if (!(authorization && authorization.includes(config.admin)))
      return res.code(401).send("unauthorized");

    let { id, pubkey } = await g(
      `user:${await g(`user:${username.toLowerCase()}`)}`
    );
    let invoices = await db.lRange(`${id}:invoices`, 0, -1);
    let payments = await db.lRange(`${id}:payments`, 0, -1);

    for (let { id } of invoices) db.del(`invoice:${id}`);
    for (let { id } of payments) db.del(`payment:${id}`);
    db.del(`user:${username.toLowerCase()}`);
    db.del(`user:${id}`);
    db.del(`user:${pubkey}`);

    res.send({});
  },

  async lower(req, res) {
    for await (let k of db.scanIterator({ MATCH: "payment:*" })) {
      let p = await g(k);
      if (p.ref && p.ref.startsWith("2dad97")) console.log(k, p);
    }

    res.send("ok");
  },
};
