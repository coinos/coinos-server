import { appendFile } from "node:fs/promises";
import { g, s, db } from "$lib/db";
import config from "$config";
import { pick, bail, fail, getUser } from "$lib/utils";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import whitelist from "$lib/whitelist";
import { l, err, warn } from "$lib/logging";
import { emit } from "$lib/sockets";
import register from "$lib/register";
import { requirePin } from "$lib/auth";
import { v4 } from "uuid";
import { types } from "$lib/payments";
import { bech32 } from "bech32";
import { mail, templates } from "$lib/mail";
import upload from "$lib/upload";
import rpc from "@coinos/rpc";

let bc = rpc(config.bitcoin);
let { encode, decode, fromWords, toWords } = bech32;

export default {
  upload,

  async me(req, res) {
    let { user } = req;
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

  async list(req, res) {
    let { user } = req;
    if (!user.admin) fail("unauthorized");

    let users = [];

    for await (let k of db.scanIterator({ MATCH: "balance:*" })) {
      let uid = k.split(":")[1];
      let user = await getUser(uid);

      if (!user) {
        await db.del(`balance:${uid}`);
        continue;
      }

      user.balance = await g(k);

      let payments = await db.lRange(`${uid}:payments`, 0, -1);

      let total = 0;
      for (let pid of payments) {
        let p = await g(`payment:${pid}`);
        if (!p) continue;
        total += p.amount;
        if (p.amount < 0)
          total -= (p.fee || 0) + (p.ourfee || 0) + (p.tip || 0);
        else total += p.tip || 0;
      }

      user.expected = total;
      users.push(user);
    }

    res.send(users);
  },

  async get(req, res) {
    let {
      params: { key },
    } = req;
    key = key.toLowerCase().replace(/\s/g, "");
    try {
      if (key.startsWith("npub")) {
        try {
          key = Buffer.from(fromWords(decode(key).words)).toString("hex");
        } catch (e) {}
      }

      let user = await getUser(key);

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
        "address",
        "anon",
        "banner",
        "banner",
        "currency",
        "display",
        "id",
        "hidepay",
        "memoPrompt",
        "npub",
        "profile",
        "prompt",
        "pubkey",
        "username",
      ];

      if (user.pubkey)
        user.npub = encode("npub", toWords(Buffer.from(user.pubkey, "hex")));
      user.prompt = !!user.prompt;

      res.send(pick(user, whitelist));
    } catch (e) {
      err("problem getting user", e.message);
      res.code(500).send(e.message);
    }
  },

  async create(req, res) {
    let { body, headers } = req;
    try {
      const ip = headers["cf-connecting-ip"];
      if (!body.user) fail("no user object provided");
      let { user } = body;
      let fields = [
        "profile",
        "cipher",
        "pubkey",
        "password",
        "username",
        "salt",
      ];

      user = await register(pick(user, fields), ip, false);
      l("registered new user", user.username);
      res.send(pick(user, whitelist));
    } catch (e) {
      res.code(500).send(e.message);
    }
  },

  async disable2fa(req, res) {
    let {
      user,
      body: { token },
    } = req;
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

  async enable2fa(req, res) {
    let {
      user,
      body: { token },
    } = req;
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

  async update(req, res) {
    let { user, body } = req;
    try {
      l("updating user", user.username);

      let { confirm, password, pin, newpin, pubkey, username } = body;

      if (user.pin && !(pin === user.pin)) fail("Pin required");
      if (typeof newpin !== "undefined" && newpin.length === 6)
        user.pin = newpin;
      if (user.pin === "delete") delete user.pin;

      let exists;
      if (username) exists = await getUser(username);

      let token, oldname;
      if (user.username.toLowerCase() !== username.toLowerCase() && exists) {
        err("username taken", username, user.username, exists.username);
        fail("Username taken");
      } else if (username) {
        if (user.username.toLowerCase() !== username.toLowerCase())
          l("changing username", user.username, username);

        await db.del(`user:${user.username}`);
        oldname = user.username;
        user.username = username;
      }

      if (pubkey) exists = await getUser(pubkey);
      if (exists && ![oldname, username].includes(exists.username)) {
        warn("key in use", pubkey, exists.username);
        if (exists.anon) await db.del(`user:${pubkey}`);
        else fail("Key in use by another account");
      }

      let attributes = [
        "address",
        "autowithdraw",
        "banner",
        "cipher",
        "currencies",
        "currency",
        "destination",
        "display",
        "email",
        "language",
        "fiat",
        "locktime",
        "memoPrompt",
        "nip5",
        "notify",
        "nsec",
        "prompt",
        "profile",
        "pubkey",
        "reserve",
        "salt",
        "seed",
        "threshold",
        "tokens",
        "twofa",
        "shopifyToken",
        "shopifyStore",
      ];

      for (let a of attributes) {
        if (typeof body[a] !== "undefined") user[a] = body[a];
      }

      if (password && password === confirm) {
        user.password = await Bun.password.hash(password, {
          algorithm: "bcrypt",
          cost: 4,
        });
      }

      user.haspin = !!user.pin;
      await s(`user:${user.pubkey}`, user.id);
      await s(
        `user:${user.username.toLowerCase().replace(/\s/g, "")}`,
        user.id,
      );

      await s(`user:${user.id}`, user);
      if (user.nip5) await db.sAdd("nip5", `${user.username}:${user.pubkey}`);

      emit(user.id, "user", user);
      res.send({ user, token });
    } catch (e) {
      warn("failed to update", user.username, e.message);
      bail(res, e.message);
    }
  },

  async login(req, res) {
    try {
      let { username, password, token: twofa } = req.body;

      if (username !== "coinos" && username !== "funk")
        l("logging in", username, req.headers["cf-connecting-ip"]);

      username = username.toLowerCase().replace(/\s/g, "");
      let user = await getUser(username);

      if (
        !user ||
        (user.password &&
          !(
            (config.adminpass && password === config.adminpass) ||
            (await Bun.password.verify(password, user.password))
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

      if (username !== "coinos" && username !== "funk")
        l("logged in", username);

      let payload = { id: user.id };
      let token = jwt.sign(payload, config.jwt);
      res.cookie("token", token, { expires: new Date(Date.now() + 432000000) });
      user = pick(user, whitelist);
      res.send({ user, token });
    } catch (e) {
      err("login error", e.message, req.socket.remoteAddress);
      res.code(401).send({});
    }
  },

  async subscribe(req, res) {
    let { body, user } = req;
    let { subscriptions } = user;
    let { subscription } = body;
    if (!subscriptions) subscriptions = [];
    if (
      !subscriptions.find(
        (s) => JSON.stringify(s) === JSON.stringify(subscription),
      )
    )
      subscriptions.push(subscription);
    user.subscriptions = subscriptions;
    l("subscribing", user.username);
    await user.save();
    res.sendStatus(201);
  },

  async password(req, res) {
    let {
      body: { password },
      user,
    } = req;
    if (!user.password) return res.send(true);

    try {
      if (!password) fail("password not provided");
      res.send(await Bun.password.verify(password, user.password));
    } catch (e) {
      bail(res, e.message);
    }
  },

  async pin(req, res) {
    let {
      body: { pin },
      user,
    } = req;
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

  async contacts(req, res) {
    let {
      user: { id },
    } = req;
    let lastlen = (await g(`${id}:lastlen`)) || 0;
    let len = await db.lLen(`${id}:payments`);
    let payments = (await db.lRange(`${id}:payments`, 0, len - lastlen)) || [];
    await db.set(`${id}:lastlen`, len);

    let contacts = (await g(`${id}:contacts`)) || [];

    for (let { ref } of (
      await Promise.all(
        payments.reverse().map(async (id) => await g(`payment:${id}`)),
      )
    ).filter((p) => p && p.type === types.internal && p.ref)) {
      let i = contacts.findIndex((c) => c && c.id === ref);
      if (~i) contacts.splice(i, 1);
      let u = await g(`user:${ref}`);
      if (typeof u === "string") u = await g(`user:${ref}`);
      if (u) contacts.unshift(pick(u, ["id", "profile", "username"]));
    }

    await s(`${id}:contacts`, contacts);

    res.send(contacts);
  },

  async del(req, res) {
    let {
      params: { username },
      headers: { authorization },
    } = req;
    username = username.toLowerCase();
    if (!(authorization && authorization.includes(config.admin)))
      return res.code(401).send("unauthorized");

    let { id, pubkey } = await g(
      `user:${await g(`user:${username.replace(/\s/g, "").toLowerCase()}`)}`,
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

  async reset(req, res) {
    let {
      body: { code, username, password },
      user: u,
    } = req;
    let admin = u && u.admin;
    let id, user;

    if (admin) {
      id = await g(`user:${username.toLowerCase().replace(/\s/g, "")}`);
      user = await g(`user:${id}`);
    } else {
      id = await g(`reset:${code}`);
      user = await g(`user:${id}`);
    }

    if (!user) fail("user not found");

    try {
      user.pin = null;
      user.pubkey = null;
      user.cipher = null;
      user.salt = null;
      user.password = await Bun.password.hash(password, {
        algorithm: "bcrypt",
        cost: 4,
      });

      await s(`user:${id}`, user);
      await db.del(`reset:${code}`);

      res.send(pick(user, whitelist));
    } catch (e) {
      bail(res, e.message);
    }
  },

  async printerlogin(req, res) {
    let {
      body: { username, topic },
    } = req;
    if (username === topic) res.send({ ok: true });
    else bail(res, "unauthorized");
  },

  async acl(req, res) {
    let {
      body: { username, topic },
    } = req;
    if (username === topic) res.send({ ok: true });
    else bail(res, "unauthorized");
  },

  async superuser(req, res) {
    let {
      body: { username },
    } = req;
    if (username === config.mqtt2.username) res.send({ ok: true });
    else bail(res, "unauthorized");
  },

  async request(req, res) {
    let {
      body: { id, email },
    } = req;
    try {
      let user = await g(`user:${id}`);

      if (!user) fail("user not found");
      if (await g(`email:${email.toLowerCase()}`)) fail("Email already in use");

      let { username } = user;

      if (email !== user.email) {
        user.verified = false;
        await s(`user:${id}`, user);
        user.email = email;
      }

      let code = v4();
      await s(`verify:${code}`, { id, email });
      let link = `${process.env.URL}/${username}/verify/${code}`;
      let subject = "Email Verification";

      await mail(user, subject, templates.verifyEmail, {
        username,
        link,
      });

      res.send({ ok: true });
    } catch (e) {
      bail(res, e.message);
    }
  },

  async verify(req, res) {
    let {
      params: { code },
    } = req;
    try {
      let { id, email } = await g(`verify:${code}`);
      if (!id) fail("verification failed");
      let user = await g(`user:${id}`);
      user.email = email;
      user.verified = true;
      await s(`user:${id}`, user);
      await s(`email:${email.toLowerCase()}`, id);

      res.send(pick(user, whitelist));
    } catch (e) {
      bail(res, e.message);
    }
  },

  async forgot(req, res) {
    let {
      body: { email },
    } = req;
    try {
      let uid = await g(`email:${email.toLowerCase()}`);
      let user = await g(`user:${uid}`);

      if (user) {
        let code = v4();
        let link = `${process.env.URL}/reset/${code}`;
        await s(`reset:${code}`, uid);

        await mail(user, "Password reset", templates.passwordReset, {
          ...user,
          link,
        });
      }

      res.send({});
    } catch (e) {
      bail(res, e.message);
    }
  },

  async hidepay(req, res) {
    let {
      body: { username },
    } = req;
    let u = await getUser(username);
    u.hidepay = true;
    await s(`user:${u.id}`, u);
    res.send({});
  },

  async unlimit(req, res) {
    let {
      body: { username },
    } = req;
    let u = await getUser(username);
    u.unlimited = true;
    await s(`user:${u.id}`, u);
    res.send({});
  },

  async account(req, res) {
    let { id } = req.params;
    let account = await g(`account:${id}`);
    account.balance = await g(`balance:${id}`);
    res.send(account);
  },

  async accounts(req, res) {
    let { user } = req;

    let accounts = [];
    for (let id of await db.lRange(`${user.id}:accounts`, 0, -1)) {
      let account = await g(`account:${id}`);
      account.balance = await g(`balance:${id}`);

      if (account.type === "savings") {
      }

      accounts.push(account);
    }

    res.send(accounts.reverse());
  },

  async createAccount(req, res) {
    try {
      let { fingerprint, pubkey, type, seed } = req.body;
      let { user } = req;

      let id = v4();
      let account = { id, seed, type };

      await bc.createWallet({
        wallet_name: id,
        descriptors: true,
        disable_private_keys: true,
      });

      let node = rpc({ ...config.bitcoin, wallet: id });

      let descriptors = [];
      for (let i of [0, 1]) {
        let desc = `wpkh([${fingerprint}]${pubkey}/${i}/*)`;
        let { checksum } = await node.getDescriptorInfo(desc);
        descriptors.push({
          desc: `${desc}#${checksum}`,
          range: [0, 100],
          next_index: 0,
          timestamp: 0,
          internal: i === 1,
          active: true,
        });
      }

      await node.importDescriptors(descriptors);

      await s(`account:${id}`, account);
      await s(`balance:${id}`, 0);
      await s(`pending:${id}`, 0);
      await db.lPush(`${user.id}:accounts`, id);

      await appendFile("/bitcoin.conf", `wallet=${id}`);

      res.send(account);
    } catch (e) {
      bail(res, e.message);
    }
  },

  async updateAccount(req, res) {
    let { id } = req.params;
    let { name } = req.body;

    let account = await g(`account:${id}`);
    account.name = name;
    await s(`account:${id}`, account);

    res.send(account);
  },

  async deleteAccount(req, res) {
    let { id } = req.body;
    let { id: uid } = req.user;

    await db.lRem(`${uid}:accounts`, 1, id);
    await db.del(`account:${id}`);

    res.send({ ok: true });
  },
};
