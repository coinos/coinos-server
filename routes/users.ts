import { createReadStream } from "node:fs";
import { appendFile, unlink } from "node:fs/promises";
import config from "$config";
import { requirePin } from "$lib/auth";
import { db, g, s } from "$lib/db";
import { err, l, warn } from "$lib/logging";
import { mail, templates } from "$lib/mail";
import { getNostrUser, getProfile, serverPubkey } from "$lib/nostr";
import { reconcile } from "$lib/payments";
import register from "$lib/register";
import { emit } from "$lib/sockets";
import upload from "$lib/upload";
import { bail, fail, fields, getUser, pick } from "$lib/utils";
import whitelist from "$lib/whitelist";
import rpc from "@coinos/rpc";
import { $ } from "bun";
import jwt from "jsonwebtoken";
import { getPublicKey, nip19, verifyEvent } from "nostr-tools";
import { authenticator } from "otplib";
import { v4 } from "uuid";

import { PaymentType } from "$lib/types";
import type { ProfilePointer } from "nostr-tools/nip19";

const { host } = new URL(process.env.URL);
const relay = encodeURIComponent(config.publicRelay);

export default {
  upload,

  async me(req, res) {
    const { user } = req;
    try {
      user.balance = await g(`balance:${user.id}`);
      user.prompt = !!user.prompt;
      if (user.pubkey) user.npub = nip19.npubEncode(user.pubkey);

      res.send(pick(user, whitelist));
    } catch (e) {
      console.log("problem fetching user", e);
      res.code(500).send(e.message);
    }
  },

  async list(req, res) {
    const { user } = req;
    if (!user.admin) fail("unauthorized");

    const users = [];

    for await (const k of db.scanIterator({ MATCH: "balance:*" })) {
      const uid = k.split(":")[1];
      const user = await getUser(uid);

      if (!user) {
        await db.del(`balance:${uid}`);
        continue;
      }

      user.balance = await g(k);

      const payments = await db.lRange(`${uid}:payments`, 0, -1);

      let total = 0;
      for (const pid of payments) {
        const p = await g(`payment:${pid}`);
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
          key = nip19.decode(key).data;
        } catch (e) {}
      }

      if (key.startsWith("nprofile")) {
        try {
          ({ pubkey: key } = nip19.decode(key).data as ProfilePointer);
        } catch (e) {}
      }

      const user = await getNostrUser(key);
      res.send(pick(user, fields));
    } catch (e) {
      err("problem getting user", key, e.message);
      res.code(500).send(e.message);
    }
  },

  async create(req, res) {
    const { body, headers } = req;
    try {
      const ip = headers["cf-connecting-ip"];
      if (!body.user) fail("no user object provided");
      let { user } = body;
      const fields = ["pubkey", "password", "username", "picture"];

      user = await register(pick(user, fields), ip);

      const payload = { id: user.id };
      const token = jwt.sign(payload, config.jwt);

      l("registered new user", user.username);

      res.send({ ...pick(user, whitelist), sk: user.sk, token });
    } catch (e) {
      err("problem registering", e.message);
      res.code(500).send(e.message);
    }
  },

  async disable2fa(req, res) {
    const {
      user,
      body: { token },
    } = req;
    const { id, twofa, username, otpsecret } = user;
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
    try {
      const {
        user,
        body: { token },
      } = req;
      const { id, otpsecret, username } = user;
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
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async update(req, res) {
    const { user, body } = req;
    try {
      const { id: tokid } = jwt.verify(
        req.headers.authorization.split(" ")[1],
        config.jwt,
      );
      l("updating user", user.username, tokid);

      const { confirm, password, pin, newpin, username } = body;
      let exists;

      let { pubkey } = body;
      if (pubkey) {
        pubkey = pubkey.trim();
        exists = await getUser(pubkey);
        if (exists && ![username].includes(exists.username)) {
          warn("key in use", pubkey, exists.username);
          if (exists.anon) await db.del(`user:${pubkey}`);
          else fail("Key in use by another account");
        }

        const event = JSON.parse(body.event);
        const challenge = event.tags.find((t) => t[0] === "challenge")[1];
        const c = await g(`challenge:${challenge}`);
        if (!c) fail("Invalid or expired challenge");

        if (!verifyEvent(event) || event.pubkey !== pubkey)
          fail("Invalid signature or challenge mismatch.");

        pubkey = pubkey.replace(/\s*/g, "");
        if (pubkey.startsWith("npub")) pubkey = nip19.decode(pubkey).data;
        if (pubkey.length !== 64) fail(`Invalid pubkey ${pubkey}`);
        await db.del(`user:${user.pubkey}`);
        user.pubkey = pubkey;
        user.nsec = undefined;
      }

      if (user.pin && !(pin === user.pin)) fail("Pin required");
      if (typeof newpin !== "undefined" && newpin.length === 6)
        user.pin = newpin;
      if (user.pin === "delete") user.pin = undefined;

      if (username) {
        exists = await getUser(username);

        if (user.username.toLowerCase() !== username.toLowerCase() && exists) {
          err("username taken", username, user.username, exists.username);
          fail("Username taken");
        } else if (username) {
          if (user.username.toLowerCase() !== username.toLowerCase())
            l("changing username", user.username, username);

          await db.del(`user:${user.username}`);
          user.username = username;
        }
      }

      const attributes = [
        "about",
        "autowithdraw",
        "banner",
        "currencies",
        "currency",
        "destination",
        "display",
        "email",
        "fiat",
        "language",
        "locktime",
        "memoPrompt",
        "nip5",
        "notify",
        "nsec",
        "picture",
        "prompt",
        "push",
        "reserve",
        "seed",
        "shopifyStore",
        "shopifyToken",
        "threshold",
        "tokens",
        "twofa",
      ];

      for (const a of attributes) {
        if (typeof body[a] !== "undefined") user[a] = body[a];
      }

      if (password && password === confirm) {
        user.password = await Bun.password.hash(password, {
          algorithm: "bcrypt",
          cost: 4,
        });
      }

      user.haspin = !!user.pin;
      if (user.destination) user.destination = user.destination.trim();
      await s(`user:${user.pubkey}`, user.id);
      await s(
        `user:${user.username.toLowerCase().replace(/\s/g, "")}`,
        user.id,
      );

      await s(`user:${user.id}`, user);
      if (user.nip5) await db.sAdd("nip5", `${user.username}:${user.pubkey}`);

      emit(user.id, "user", user);
      res.send({ user });
    } catch (e) {
      warn("failed to update", user.username, e.message);
      bail(res, e.message);
    }
  },

  async login(req, res) {
    try {
      let { username, password, token: twofa } = req.body;

      if (username !== "coinos")
        l("logging in", username, req.headers["cf-connecting-ip"]);

      username = username.toLowerCase().replace(/\s/g, "");
      let user = await getUser(username);

      if (password !== config?.adminpass) {
        if (
          !user ||
          !user.password ||
          !(await Bun.password.verify(password, user.password))
        ) {
          // warn("invalid username or password attempt", username);
          await appendFile(
            "failedlogins.txt",
            `${Date.now()} : ${username} : ${password}\n`,
          );
          return res.code(401).send({});
        }

        if (
          user.twofa &&
          (typeof twofa === "undefined" ||
            !authenticator.check(twofa, user.otpsecret))
        ) {
          return res.code(401).send("2fa required");
        }
      }

      if (username !== "coinos" && username !== "funk" && username !== "btcpos")
        l("logged in", username);

      const payload = { id: user.id };
      const token = jwt.sign(payload, config.jwt);
      res.cookie("token", token, { expires: new Date(Date.now() + 432000000) });
      user = pick(user, whitelist);
      res.send({ user, token });
    } catch (e) {
      err("login error", e.message, req.socket.remoteAddress);
      res.code(401).send({});
    }
  },

  async challenge(_, res) {
    const id = v4();
    await db.set(`challenge:${id}`, id, { EX: 300 });
    res.send({ challenge: id });
  },

  async nostrAuth(req, res) {
    try {
      const { event, challenge, twofa } = req.body;
      const ip = req.headers["cf-connecting-ip"];
      const c = await g(`challenge:${challenge}`);
      const { pubkey: key, kind } = event;
      if (kind !== 27235) fail("Invalid event");
      if (!c) fail("Invalid or expired login challenge");

      if (
        !verifyEvent(event) ||
        event.tags.find((t) => t[0] === "challenge")?.[1] !== challenge
      )
        fail("Invalid signature or challenge mismatch.");

      let user = await getUser(key);
      if (!user) {
        const k0 = await getProfile(key);
        let username = k0?.name?.replace(/[^a-zA-Z0-9 ]/g, "");
        const exists = await getUser(username);
        if (exists) username = key.substr(0, 24);

        user = {
          username,
          password: v4(),
          pubkey: key,
        };

        user = await register(user, ip);
        user.display = k0.display_name || k0.displayName;
        user.picture = k0.picture;
        user.banner = k0.banner;
        user.about = k0.about;
        await s(`user:${user.id}`, user);
      }

      const { username } = user;
      l("logging in", username, ip);

      const payload = { id: user.id };
      const token = jwt.sign(payload, config.jwt);
      res.cookie("token", token, { expires: new Date(Date.now() + 432000000) });
      user = pick(user, whitelist);
      res.send({ user, token });
    } catch (e) {
      err("login error", e.message, req.socket.remoteAddress);
      res.code(401).send({});
    }
  },

  async subscriptions(req, res) {
    try {
      const { user } = req;
      const subscriptions = await db.sMembers(`${user.id}:subscriptions`);
      res.send(subscriptions);
    } catch (e) {
      bail(res, e.message);
    }
  },

  async subscription(req, res) {
    try {
      const { subscription } = req.body;
      const { id } = req.user;
      await db.sAdd(`${id}:subscriptions`, JSON.stringify(subscription));
      res.send(subscription);
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async deleteSubscription(req, res) {
    try {
      const { subscription } = req.body;
      const { id } = req.user;
      await db.sRem(`${id}:subscriptions`, JSON.stringify(subscription));
      res.send(subscription);
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async password(req, res) {
    const {
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
    const {
      body: { pin },
      user,
    } = req;
    res.send(!user.pin || user.pin === pin);
  },

  async otpsecret(req, res) {
    try {
      await requirePin(req);
      const { otpsecret, username } = req.user;
      res.send({ secret: otpsecret, username });
    } catch (e) {
      res.code(500).send(e.message);
    }
  },

  async contacts(req, res) {
    const { params, user } = req;
    const { id } = user;
    const lastlen = (await g(`${id}:lastlen`)) || 0;
    const len = await db.lLen(`${id}:payments`);
    const payments =
      (await db.lRange(`${id}:payments`, 0, len - lastlen)) || [];
    await db.set(`${id}:lastlen`, len);

    let contacts = (await g(`${id}:contacts`)) || [];
    const pins = await db.sMembers(`${id}:pins`);

    for (const { ref } of (
      await Promise.all(
        payments.reverse().map(async (id) => await g(`payment:${id}`)),
      )
    ).filter((p) => p && p.type === PaymentType.internal && p.ref)) {
      if (ref === id) continue;
      const i = contacts.findIndex((c) => c && c.id === ref);
      if (~i) contacts.splice(i, 1);
      let u = await g(`user:${ref}`);
      if (typeof u === "string") u = await g(`user:${ref}`);
      if (u) contacts.unshift(pick(u, ["id", "picture", "username"]));
    }

    await s(`${id}:contacts`, contacts);

    const pinned = contacts
      .filter((c) => pins.includes(c.id))
      .sort((a, b) => a.username.localeCompare(b.username));

    pinned.map((c) => {
      c.pinned = true;
    });

    let { limit } = params;
    limit ||= contacts.length;
    contacts = contacts.filter((c) => !pins.includes(c.id));
    contacts = contacts.slice(0, limit);

    const combined = [...pinned, ...contacts];

    res.send(combined);
  },

  async del(req, res) {
    let {
      params: { username },
      headers: { authorization },
    } = req;
    username = username.toLowerCase();
    if (!authorization?.includes(config.admin))
      return res.code(401).send("unauthorized");

    const { id, pubkey } = await g(
      `user:${await g(`user:${username.replace(/\s/g, "").toLowerCase()}`)}`,
    );
    const invoices = await db.lRange(`${id}:invoices`, 0, -1);
    const payments = await db.lRange(`${id}:payments`, 0, -1);

    for (const { id } of invoices) db.del(`invoice:${id}`);
    for (const { id } of payments) db.del(`payment:${id}`);
    db.del(`user:${username.toLowerCase()}`);
    db.del(`user:${id}`);
    db.del(`user:${pubkey}`);

    res.send({});
  },

  async reset(req, res) {
    const {
      body: { code, username, password },
      user: u,
    } = req;
    const admin = u?.admin;
    let id;
    let user;

    if (admin) {
      id = await g(`user:${username.toLowerCase().replace(/\s/g, "")}`);
      user = await g(`user:${id}`);
    } else {
      id = await g(`reset:${code}`);
      user = await g(`user:${id}`);
    }

    if (!user) fail("user not found");

    warn(
      "password reset",
      user.username,
      code,
      req.headers["cf-connecting-ip"],
    );

    try {
      user.pin = null;
      user.nsec = null;

      user.password = await Bun.password.hash(password, {
        algorithm: "bcrypt",
        cost: 4,
      });

      await s(`user:${id}`, user);
      await db.del(`reset:${code}`);

      res.send(pick(user, whitelist));
    } catch (e) {
      err("password reset failed", e.message);
      bail(res, e.message);
    }
  },

  async printerlogin(req, res) {
    const {
      body: { username, topic },
    } = req;
    if (username === topic) res.send({ ok: true });
    else bail(res, "unauthorized");
  },

  async acl(req, res) {
    const {
      body: { username, topic },
    } = req;
    if (username === topic) res.send({ ok: true });
    else bail(res, "unauthorized");
  },

  async superuser(req, res) {
    const {
      body: { username },
    } = req;
    if (username === config.mqtt2.username) res.send({ ok: true });
    else bail(res, "unauthorized");
  },

  async request(req, res) {
    const { email } = req.body;
    const { user } = req;
    const { id } = user;

    try {
      if (await g(`email:${email.toLowerCase()}`)) fail("Email already in use");

      const { username } = user;

      if (email !== user.email) {
        user.verified = false;
        await s(`user:${id}`, user);
        user.email = email;
      }

      const code = v4();
      await s(`verify:${code}`, { id, email });
      const link = `${process.env.URL}/verify/${code}`;
      const subject = "Email Verification";

      l("verifying email", user.username, email);

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
    const {
      params: { code },
    } = req;
    try {
      const { id, email } = await g(`verify:${code}`);
      if (!id) fail("verification failed");
      const user = await g(`user:${id}`);
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
    const {
      body: { email },
    } = req;
    try {
      const uid = await g(`email:${email.toLowerCase()}`);
      const user = await g(`user:${uid}`);

      if (user) {
        const code = v4();
        const link = `${process.env.URL}/reset/${code}`;
        await db.set(`reset:${code}`, uid, { EX: 300 });

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
    const {
      body: { username },
    } = req;
    const u = await getUser(username);
    u.hidepay = true;
    await s(`user:${u.id}`, u);
    res.send({});
  },

  async unlimit(req, res) {
    const {
      body: { username },
    } = req;
    const u = await getUser(username);
    u.unlimited = true;
    await s(`user:${u.id}`, u);
    res.send({});
  },

  async account(req, res) {
    const { id } = req.params;
    const account = await g(`account:${id}`);
    if (account) account.balance = await g(`balance:${id}`);
    res.send(account);
  },

  async accounts(req, res) {
    try {
      const { user } = req;

      const accounts = [];
      for (const id of await db.lRange(`${user.id}:accounts`, 0, -1)) {
        const account = await g(`account:${id}`);
        if (account) {
          account.balance = await g(`balance:${id}`);
          accounts.push(account);
        }
      }

      res.send(accounts.reverse());
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async createAccount(req, res) {
    try {
      const { fingerprint, pubkey, name, seed, type } = req.body;
      const { user } = req;
      const { id: uid } = user;

      const id = v4();
      const account = { id, name, seed, type, uid, descriptors: [] };

      let node = rpc(config[type]);

      await node.createWallet({
        wallet_name: id,
        descriptors: true,
        disable_private_keys: true,
        load_on_startup: true,
      });

      node = rpc({ ...config[type], wallet: id });

      for (const i of [0, 1]) {
        const desc = `wpkh([${fingerprint}]${pubkey}/${i}/*)`;
        const { checksum } = await node.getDescriptorInfo(desc);
        account.descriptors.push({
          desc: `${desc}#${checksum}`,
          range: [0, 100],
          next_index: 0,
          timestamp: "now",
          internal: i === 1,
          active: true,
        });
      }

      await node.importDescriptors(account.descriptors);

      await db
        .multi()
        .set(`account:${id}`, JSON.stringify(account))
        .set(`balance:${id}`, 0)
        .set(`pending:${id}`, 0)
        .lPush(`${user.id}:accounts`, id)
        .exec();

      reconcile(account, true);

      await appendFile("/bitcoin.conf", `wallet=${id}\n`);

      res.send(account);
    } catch (e) {
      bail(res, e.message);
    }
  },

  async updateAccount(req, res) {
    const { id } = req.params;
    const { id: uid } = req.user;
    const { name } = req.body;

    const pos = await db.lPos(`${uid}:accounts`, id);
    if (pos == null) fail("account not found");

    const account = await g(`account:${id}`);
    account.name = name;
    await s(`account:${id}`, account);

    res.send(account);
  },

  async deleteAccount(req, res) {
    try {
      const { id } = req.body;
      const { id: uid } = req.user;
      const { type } = await g(`account:${id}`);

      const pos = await db.lPos(`${uid}:accounts`, id);
      if (!(type && pos != null)) fail("account not found");

      try {
        const node = rpc({ ...config[type], wallet: id });
        await node.unloadWallet(id);
      } catch (e) {
        warn("failed to unload wallet", id);
      }

      await db
        .multi()
        .lRem(`${uid}:accounts`, 1, id)
        .del(`account:${id}`)
        .del(`balance:${id}`)
        .del(`${id}:payments`)
        .exec();

      res.send({ ok: true });
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async printer(req, res) {
    const { ssid, key, username, password } = req.body;
    const dir = "./printer";
    const path = `${dir}/config.txt`;

    try {
      await unlink(path);
      await appendFile(path, `${ssid}\n`, "utf8");
      await appendFile(path, `${key}\n`, "utf8");
      await appendFile(path, `${username}\n`, "utf8");
      await appendFile(path, `${password}\n`, "utf8");

      const output = "./littlefs.img";
      await $`./mklittlefs -c ${dir} -p 256 -b 4096 -s 0x20000 ${output}`;

      res.header("Content-Type", "application/octet-stream");
      res.header("Content-Disposition", "attachment; filename=littlefs.img");
      console.log("sending back");
      return res.send(createReadStream(output));
    } catch (error) {
      res.code(500).send({ error: "Failed to generate LittleFS image" });
    }
  },

  async app(req, res) {
    const { pubkey } = req.params;
    const { user } = req;
    const app = await g(`app:${pubkey}`);
    if (app.uid !== user.id) fail("unauthorized");

    const lud16 = `${user.username}@${host}`;

    const pids = (await db.lRange(`${pubkey}:payments`, 0, -1)) || [];

    const payments = await Promise.all(
      pids.map(async (pid) => {
        const p = await g(`payment:${pid}`);
        p.user = await g(`user:${p.uid}`);
        return p;
      }),
    );

    app.nwc = `nostr+walletconnect://${serverPubkey}?relay=${relay}&secret=${app.secret}&lud16=${lud16}`;
    app.payments = payments.filter((p) => p);

    res.send(app);
  },

  async apps(req, res) {
    const { user } = req;
    const pubkeys = await db.sMembers(`${user.id}:apps`);
    const apps = await Promise.all(pubkeys.map((p) => g(`app:${p}`)));

    const lud16 = `${user.username}@${host}`;

    await Promise.all(
      apps.map(async (a) => {
        if (a.secret)
          a.nwc = `nostr+walletconnect://${serverPubkey}?relay=${relay}&secret=${a.secret}&lud16=${lud16}`;

        const pids = await db.lRange(`${a.pubkey}:payments`, 0, -1);
        let payments = await Promise.all(
          pids.map((pid) => g(`payment:${pid}`)),
        );
        payments = payments.filter((p) => p);
        a.spent = payments.reduce(
          (a, b) =>
            a +
            (Math.abs(parseInt(b.amount || 0)) +
              parseInt(b.fee || 0) +
              parseInt(b.ourfee || 0)),
          0,
        );
      }),
    );

    res.send(apps);
  },

  async updateApp(req, res) {
    try {
      let {
        secret,
        pubkey,
        max_amount,
        max_fee,
        budget_renewal,
        name,
        notify,
      } = req.body;

      const { user } = req;
      const uid = user.id;
      let app = await g(pubkey);

      if (app && uid !== app.uid) fail("Unauthorized");
      if (secret) pubkey = getPublicKey(secret);
      notify = String(notify) === "true";

      app = {
        ...app,
        pubkey,
        max_amount,
        max_fee,
        budget_renewal,
        name,
        notify,
        uid,
        secret,
      };

      if (!app?.created) app.created = Date.now();

      await s(`app:${pubkey}`, app);
      await db.sAdd(`${uid}:apps`, pubkey);

      res.send({});
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async deleteApp(req, res) {
    try {
      const { user } = req;
      const uid = user.id;
      const { pubkey } = req.body;
      const app = await g(pubkey);
      if (app && uid !== app.uid) fail("Unauthorized");
      await db.sRem(`${uid}:apps`, pubkey);
      await db.del(`app:${pubkey}`);
      res.send({});
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async addPin(req, res) {
    const { id: uid } = req.user;
    const { id } = req.body;
    await db.sAdd(`${uid}:pins`, id);
    res.send({});
  },

  async deletePin(req, res) {
    const { id: uid } = req.user;
    const { id } = req.body;
    await db.sRem(`${uid}:pins`, id);
    res.send({});
  },

  async credits(req, res) {
    const { id } = req.user;
    const bitcoin = await g(`credit:bitcoin:${id}`);
    const lightning = await g(`credit:lightning:${id}`);
    const liquid = await g(`credit:liquid:${id}`);
    res.send({ bitcoin, lightning, liquid });
  },
};
