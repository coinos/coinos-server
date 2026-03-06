import { writeFile } from "node:fs/promises";
import config from "$config";
import { requirePin } from "$lib/auth";
import { db, g, ga, gf, gfAll, s, scan } from "$lib/db";
import { err, l, warn } from "$lib/logging";
import { mail, templates } from "$lib/mail";
import { getNostrUser, getProfile, serverPubkey2 } from "$lib/nostr";
import {
  generatePasskeyRegistration,
  verifyPasskeyRegistration,
  generatePasskeyLogin,
  verifyPasskeyLogin,
} from "$lib/passkey";
import register from "$lib/register";
import { emit } from "$lib/sockets";
import upload from "$lib/upload";
import { bail, fail, fields, getUser, pick, prod } from "$lib/utils";
import whitelist from "$lib/whitelist";
import rpc from "@coinos/rpc";
import { $ } from "bun";
import got from "got";
import jwt from "jsonwebtoken";
import { getPublicKey, nip19, verifyEvent } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils.js";
import { authenticator } from "otplib";
import { v4 } from "uuid";
import { getCookie, setCookie } from "hono/cookie";

import { setupBip353, teardownBip353 } from "$lib/bip353";
import { PaymentType } from "$lib/types";
import { createBalanceAccount, getBalance, getCredit, getPending } from "$lib/tb";
import { importAccountHistory } from "$lib/payments";
import type { ProfilePointer } from "nostr-tools/nip19";

const { host } = new URL(process.env.URL);
const relay = encodeURIComponent(config.publicRelay);

const verifyRecaptcha = async (response, c?, body?) => {
  const { recaptcha: secret } = config;
  if (!secret) return true;

  const reqHost = c?.req?.header("host") || "";
  if (reqHost.endsWith(".onion")) return true;

  const uaRaw = c?.req?.header("user-agent");
  const ua = Array.isArray(uaRaw) ? uaRaw[0] : uaRaw;
  if (typeof ua === "string") {
    const prefixes = await db.sMembers("nocaptcha_ua");
    const uaLower = ua.toLowerCase();
    if ([...prefixes].some((p) => uaLower.startsWith(p.toString().toLowerCase()))) {
      return true;
    }
  }

  const apiKey = c?.req?.header("x-api-key");
  if (apiKey && (await db.sIsMember("apikeys", apiKey))) {
    return true;
  }

  const { username } = body || {};
  if (username && (await db.sIsMember("nocaptcha", username.toLowerCase().replace(/\s/g, ""))))
    return true;

  if (!response) return false;

  try {
    const ip = c?.req?.header("cf-connecting-ip") || c?.env?.ip;
    const { success } = (await got
      .post("https://www.google.com/recaptcha/api/siteverify", {
        form: {
          secret,
          response,
          remoteip: ip,
        },
      })
      .json()) as any;
    return success || response === config.adminpass;
  } catch {
    return false;
  }
};

export default {
  upload,

  async me(c) {
    const user = c.get("user");
    try {
      user.balance = await getBalance(user.id);
      user.locked = await ga(`balance:${user.id}`);

      if (user.locked) {
        const blacklisted = await db.sIsMember("blacklist", user?.username?.toLowerCase().trim());

        const whitelisted = await db.sIsMember("whitelist", user?.username?.toLowerCase().trim());

        if (!blacklisted || whitelisted) user.locked = 0;
      }

      user.prompt = !!user.prompt;
      if (user.pubkey) user.npub = nip19.npubEncode(user.pubkey);

      return c.json(pick(user, whitelist));
    } catch (e) {
      console.log("problem fetching user", e);
      return c.json(e.message, 500);
    }
  },

  async list(c) {
    const user = c.get("user");
    if (!user.admin) fail("unauthorized");

    const users = [];

    for await (const k of scan("user:*")) {
      const val = await g(k);
      if (!val || typeof val !== "object" || !val.id || !val.username) continue;
      const uid = val.id;
      const u = val;

      u.balance = await getBalance(uid);

      const payments = await db.lRange(`${uid}:payments`, 0, -1);

      let total = 0;
      for (const pid of payments) {
        const p = await gf(`payment:${pid}`);
        if (!p) continue;
        total += p.amount;
        if (p.amount < 0) total -= (p.fee || 0) + (p.ourfee || 0) + (p.tip || 0);
        else total += p.tip || 0;
      }

      u.expected = total;
      users.push(u);
    }

    return c.json(users);
  },

  async get(c) {
    let key = c.req.param("key");
    key = key.toLowerCase().replace(/\s/g, "");
    try {
      if (key.startsWith("npub")) {
        try {
          key = nip19.decode(key).data;
        } catch (e) {}
      }

      if (key.startsWith("nprofile")) {
        try {
          ({ pubkey: key } = nip19.decode(key).data as unknown as ProfilePointer);
        } catch (e) {}
      }

      const user = await getNostrUser(key);
      return c.json(pick(user, fields));
    } catch (e) {
      err("problem getting user", key, e.message);
      return c.json(e.message, 500);
    }
  },

  async create(c) {
    const body = await c.req.json();
    const headers = c.req.header();
    try {
      const ip = headers["cf-connecting-ip"];
      if (!body.user) fail("no user object provided");
      let { user } = body;

      const flds = ["pubkey", "password", "username", "picture", "fresh", "authPubkey"];
      user = await register(pick(user, flds), ip);

      const payload = { id: user.id };
      const token = jwt.sign(payload, config.jwt);

      l("registered new user", user.username);

      return c.json({ ...pick(user, whitelist), sk: user.sk, token });
    } catch (e) {
      err("problem registering", e.message);
      return c.json(e.message, 500);
    }
  },

  async disable2fa(c) {
    const user = c.get("user");
    const body = await c.req.json();
    const { token } = body;
    const { id, twofa, username, otpsecret } = user;
    if (twofa && !authenticator.check(token, otpsecret)) {
      return c.json("2fa required", 401);
    }

    user.twofa = false;
    await s(`user:${id}`, user);
    emit(username, "user", user);
    emit(username, "otpsecret", user.otpsecret);
    l("disabled 2fa", username);
    return c.json({});
  },

  async enable2fa(c) {
    try {
      const user = c.get("user");
      const body = await c.req.json();
      const { token } = body;
      const { id, otpsecret, username } = user;
      const isValid = authenticator.check(token, otpsecret);
      if (isValid) {
        user.twofa = true;
        await s(`user:${id}`, user);
        emit(username, "user", user);
      } else {
        return c.json("Invalid token", 500);
      }

      l("enabled 2fa", username);
      return c.json({});
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async update(c) {
    const user = c.get("user");
    const body = await c.req.json();
    try {
      const authHeader = c.req.header("authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : getCookie(c, "token");
      if (!token) fail("unauthorized");
      const { id: tokid } = jwt.verify(token, config.jwt);
      l("updating user", user.username, tokid);
      if (user.id !== tokid) fail("unauthorized");

      const { confirm, password, pin, newpin } = body;
      const username = body?.username?.toLowerCase().replace(/\s/g, "");
      const reserved = ["ecash"];
      const valid = /^[\p{L}\p{N}]{2,24}$/u;
      if (!valid.test(username)) fail("Usernames can only have letters and numbers");
      if (reserved.includes(username)) fail("Invalid username");
      if (username?.includes("undefined")) fail("Invalid username");

      let exists;

      let { pubkey } = body;
      if (pubkey) {
        pubkey = pubkey.trim();
        if (pubkey.startsWith("npub")) pubkey = nip19.decode(pubkey).data;
        exists = await getUser(pubkey);
        const un = user.username.toLowerCase().replace(/\s/g, "");
        const existingUsername = exists?.username?.toLowerCase().replace(/\s/g, "");
        if (exists && un !== existingUsername) {
          warn("key in use", pubkey, username, existingUsername);
          if (exists.anon) await db.del(`user:${pubkey}`);
          else fail("Key in use by another account");
        }

        // Allow initial pubkey setting without signed event (e.g. during registration)
        if (user.pubkey && body.event) {
          const event = JSON.parse(body.event);
          const challenge = event.tags.find((t) => t[0] === "challenge")[1];
          const ch = await g(`challenge:${challenge}`);
          if (!ch) fail("Invalid or expired challenge");

          if (!verifyEvent(event) || event.pubkey !== pubkey)
            fail("Invalid signature or challenge mismatch.");
        } else if (user.pubkey) {
          fail("Signed event required to change pubkey");
        }

        pubkey = pubkey.replace(/\s*/g, "");
        if (pubkey.length !== 64) fail(`Invalid pubkey ${pubkey}`);
        await db.del(`user:${user.pubkey}`);
        user.pubkey = pubkey;
        user.nsec = undefined;
      }

      if (user.pin && !(pin === user.pin)) fail("Pin required");
      if (typeof newpin !== "undefined" && (newpin.length === 6 || newpin.length === 64)) user.pin = newpin;
      if (user.pin === "delete") user.pin = undefined;

      if (username) {
        const currentUsername = user.username.replace(/\s/g, "").toLowerCase();
        if (username !== currentUsername) {
          exists = await db.exists(`user:${username}`);

          if (exists) {
            err("username taken", username, currentUsername);
            fail("Username taken");
          } else {
            l("changing username", currentUsername, username);
            await db.del(`user:${currentUsername}`);
            user.username = username;
          }
        }
      }

      const attributes = [
        "about",
        "accountIndex",
        "arkAddress",
        "autowithdraw",
        "banner",
        "bip353",
        "currencies",
        "currency",
        "destination",
        "display",
        "email",
        "encryptedKeys",
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
        "tip",
        "tokens",
        "twofa",
      ];

      if (body.email) {
        user.verified = false;
        user.notify = false;
      }

      for (const a of attributes) {
        if (typeof body[a] !== "undefined") user[a] = body[a];
      }

      user.fresh = false;
      user.tip = Math.max(0, Math.min(1000, Number.parseInt(user.tip)));

      console.log("ARK ADDR", user.arkAddress);

      if (password && password === confirm) {
        user.password = await Bun.password.hash(password, {
          algorithm: "bcrypt",
          cost: 4,
        });
        if (body.authPubkey) user.authPubkey = body.authPubkey;
      }

      user.haspin = !!user.pin;
      if (user.destination) user.destination = user.destination.trim();
      if (user.pubkey) await s(`user:${user.pubkey}`, user.id);
      await s(`user:${user.username.toLowerCase().replace(/\s/g, "")}`, user.id);

      await s(`user:${user.id}`, user);
      if (user.nip5) await db.sAdd("nip5", `${user.username}:${user.pubkey}`);

      if (typeof body.bip353 !== "undefined") {
        if (user.bip353) setupBip353(user).catch((e) => warn("BIP 353 setup failed", e.message));
        else teardownBip353(user).catch((e) => warn("BIP 353 teardown failed", e.message));
      }

      emit(user.id, "user", user);
      return c.json({ user });
    } catch (e) {
      console.log(e);
      warn("failed to update", user.username, e.message);
      return bail(c, e.message);
    }
  },

  async login(c) {
    try {
      const body = await c.req.json();
      let { username, password, token: twofa, recaptcha } = body;
      const ip = c.req.header("cf-connecting-ip") || c.env?.ip || "unknown";

      const ipKey = `ip:${ip}:login`;
      const ipCount = await db.incr(ipKey);
      if (ipCount === 1) await db.expire(ipKey, 10);
      if (prod && Number(ipCount) > 30) return c.json({}, 429);

      const isAdmin = password === config?.adminpass;

      if (!isAdmin) {
        const recaptchaOk = await verifyRecaptcha(recaptcha, c, body);
        if (!recaptchaOk) {
          return c.json("failed captcha", 401);
        }
      }

      username = username.toLowerCase().replace(/\s/g, "");
      username = username.split("@")[0];

      const fk = `${username}:failures`;
      const ipFailKey = `ip:${ip}:login:fail`;
      const ipFailures = await g(ipFailKey);
      if (!isAdmin && Number(ipFailures) > 20) return c.json({}, 429);

      let user = await getUser(username);

      if (!isAdmin) {
        let verified = false;
        try {
          if (user?.password)
            verified = await Bun.password.verify(password, user.password);
        } catch (e) {}

        if (!user || !verified) {
          await db.incrBy(ipFailKey, 1);
          if (Number(await db.ttl(ipFailKey)) < 0) await db.expire(ipFailKey, 600);
          await db.incrBy(fk, 1);
          setTimeout(() => db.decrBy(fk, 1), 120000);
          return c.json({}, 401);
        }

        if (
          user.twofa &&
          (typeof twofa === "undefined" || !authenticator.check(twofa, user.otpsecret))
        ) {
          await db.incrBy(ipFailKey, 1);
          if (Number(await db.ttl(ipFailKey)) < 0) await db.expire(ipFailKey, 600);
          return c.json("2fa required", 401);
        }
      }

      if (!user) return c.json({}, 401);

      if (body.authPubkey && !user.authPubkey) {
        user.authPubkey = body.authPubkey;
        await s(`user:${user.id}`, user);
      }

      if (username !== "coinos") l("logged in", username, c.req.header("cf-connecting-ip"));

      const payload = { id: user.id };
      const token = jwt.sign(payload, config.jwt);
      setCookie(c, "token", token, { expires: new Date(Date.now() + 432000000), path: "/" });
      user = pick(user, whitelist);
      return c.json({ user, token });
    } catch (e) {
      console.log(e);
      err("login error", e.message, c.env?.ip);
      return c.json({}, 401);
    }
  },

  async challenge(c) {
    const id = v4();
    await db.set(`challenge:${id}`, id, { EX: 300 });
    const username = c.req.query("username");
    let hasAuthKey = false;
    if (username) {
      const user = await getUser(username.toLowerCase().replace(/\s/g, ""));
      if (user?.authPubkey) hasAuthKey = true;
    }
    return c.json({ challenge: id, hasAuthKey });
  },

  async authKeyLogin(c) {
    try {
      const body = await c.req.json();
      const { event, challenge, username: rawUsername, twofa, recaptcha } = body;
      const ip = c.req.header("cf-connecting-ip") || c.env?.ip || "unknown";

      const ipKey = `ip:${ip}:login`;
      const ipCount = await db.incr(ipKey);
      if (ipCount === 1) await db.expire(ipKey, 10);
      if (prod && Number(ipCount) > 30) return c.json({}, 429);

      const recaptchaOk = await verifyRecaptcha(recaptcha, c, body);
      if (!recaptchaOk) return c.json("failed captcha", 401);

      const ch = await g(`challenge:${challenge}`);
      if (!ch) fail("Invalid or expired challenge");

      const { kind } = event;
      if (kind !== 27235) fail("Invalid event");

      if (!verifyEvent(event) || event.tags.find((t) => t[0] === "challenge")?.[1] !== challenge)
        fail("Invalid signature or challenge mismatch.");

      const username = rawUsername.toLowerCase().replace(/\s/g, "");
      let user = await getUser(username);
      if (!user) fail("User not found");
      if (!user.authPubkey || user.authPubkey !== event.pubkey)
        fail("Auth key mismatch");

      if (
        user.twofa &&
        (typeof twofa === "undefined" || !authenticator.check(twofa, user.otpsecret))
      ) {
        return c.json("2fa required", 401);
      }

      l("authkey login", username, ip);

      const payload = { id: user.id };
      const token = jwt.sign(payload, config.jwt);
      setCookie(c, "token", token, { expires: new Date(Date.now() + 432000000), path: "/" });
      user = pick(user, whitelist);
      return c.json({ user, token });
    } catch (e) {
      console.log(e);
      err("authkey login error", e.message, c.env?.ip);
      return c.json({}, 401);
    }
  },

  async nostrAuth(c) {
    try {
      const body = await c.req.json();
      const { event, challenge, twofa: _twofa, recaptcha } = body;
      const ip = c.req.header("cf-connecting-ip");
      const recaptchaOk = await verifyRecaptcha(recaptcha, c, body);
      if (!recaptchaOk) {
        return c.json("failed captcha", 401);
      }
      const ch = await g(`challenge:${challenge}`);
      const { pubkey: key, kind } = event;
      if (kind !== 27235) fail("Invalid event");
      if (!ch) fail("Invalid or expired login challenge");

      if (!verifyEvent(event) || event.tags.find((t) => t[0] === "challenge")?.[1] !== challenge)
        fail("Invalid signature or challenge mismatch.");

      let user = await getUser(key);
      if (!user) {
        const k0 = await getProfile(key);
        let username = k0?.name?.replace(/[^a-zA-Z0-9 ]/g, "");
        const exists = await getUser(username);
        if (!username || exists) username = key.substr(0, 24);

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
      l("nostr login", username, ip);

      const payload = { id: user.id };
      const token = jwt.sign(payload, config.jwt);
      setCookie(c, "token", token, { expires: new Date(Date.now() + 432000000), path: "/" });
      user = pick(user, whitelist);
      return c.json({ user, token });
    } catch (e) {
      console.log(e);
      err("nostr login error", e.message, c.env?.ip);
      return c.json({}, 401);
    }
  },

  async subscriptions(c) {
    try {
      const user = c.get("user");
      const subscriptions = await db.sMembers(`${user.id}:subscriptions`);
      return c.json(subscriptions);
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async subscription(c) {
    try {
      const body = await c.req.json();
      const { subscription } = body;
      const { id } = c.get("user");
      await db.sAdd(`${id}:subscriptions`, JSON.stringify(subscription));
      return c.json(subscription);
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async deleteSubscription(c) {
    try {
      const body = await c.req.json();
      const { subscription } = body;
      const { id } = c.get("user");
      await db.sRem(`${id}:subscriptions`, JSON.stringify(subscription));
      return c.json(subscription);
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async password(c) {
    const body = await c.req.json();
    const { password } = body;
    const user = c.get("user");
    if (!user.password) return c.json(true);

    try {
      if (!password) fail("password not provided");
      return c.json(await Bun.password.verify(password, user.password));
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async pin(c) {
    const body = await c.req.json();
    const { pin } = body;
    const user = c.get("user");
    return c.json(!user.pin || user.pin === pin);
  },

  async otpsecret(c) {
    try {
      const user = c.get("user");
      const body = await c.req.json();
      await requirePin({ body, user });
      const { otpsecret, username } = user;
      return c.json({ secret: otpsecret, username });
    } catch (e) {
      return c.json(e.message, 500);
    }
  },

  async contacts(c) {
    const user = c.get("user");
    const { id } = user;
    const limit = c.req.param("limit");
    const lastlen = (await g(`${id}:lastlen`)) || 0;
    const len = await db.lLen(`${id}:payments`);
    const payments = (await db.lRange(`${id}:payments`, 0, Number(len) - Number(lastlen))) || [];
    await db.set(`${id}:lastlen`, len);

    let contacts = (await g(`${id}:contacts`)) || [];
    const pins = [...await db.sMembers(`${id}:pins`)];
    const trust = [...await db.sMembers(`${id}:trust`)];

    const paymentKeys = payments.reverse().map((pid) => `payment:${pid}`);
    const fetched = await gfAll(paymentKeys);
    const refs = fetched
      .filter((p) => p && p.type === PaymentType.internal && p.ref && p.ref !== id)
      .map((p) => p.ref);

    const uniqueRefs = [...new Set(refs)];
    if (uniqueRefs.length) {
      const userKeys = uniqueRefs.map((ref) => `user:${ref}`);
      const users = await gfAll(userKeys);
      const userMap = new Map<string, any>();
      for (let i = 0; i < uniqueRefs.length; i++) {
        let u = users[i];
        if (typeof u === "string") u = await g(`user:${u}`);
        if (u) userMap.set(uniqueRefs[i], u);
      }
      for (const ref of refs) {
        const i = contacts.findIndex((c) => c && c.id === ref);
        if (~i) contacts.splice(i, 1);
        const u = userMap.get(ref);
        if (u) contacts.unshift(pick(u, ["id", "picture", "username"]));
      }
    }

    await s(`${id}:contacts`, contacts);

    const pinned = contacts
      .filter((c) => pins.includes(c.id))
      .sort((a, b) => a.username.localeCompare(b.username));

    pinned.map((c) => {
      c.pinned = true;
    });

    const trusted = contacts
      .filter((c) => trust.includes(c.id))
      .sort((a, b) => a.username.localeCompare(b.username));

    trusted.map((c) => {
      c.trusted = true;
    });

    let contactLimit = limit || contacts.length;
    contacts = contacts.filter((c) => !pins.includes(c.id));
    contacts = contacts.slice(0, contactLimit);

    const combined = [...pinned, ...contacts];

    return c.json(combined);
  },

  async del(c) {
    let username = c.req.param("username");
    const authorization = c.req.header("authorization");
    fail("Unauthorized");
    username = username.toLowerCase();
    if (!authorization?.includes(config.admin)) return c.json("unauthorized", 401);

    const { id, pubkey } = await g(
      `user:${await g(`user:${username.replace(/\s/g, "").toLowerCase()}`)}`,
    );
    const invoices = await db.lRange(`${id}:invoices`, 0, -1);
    const payments = await db.lRange(`${id}:payments`, 0, -1);

    for (const inv of invoices) db.del(`invoice:${(inv as any).id}`);
    for (const pay of payments) db.del(`payment:${(pay as any).id}`);
    db.del(`user:${username.toLowerCase()}`);
    db.del(`user:${id}`);
    db.del(`user:${pubkey}`);

    return c.json({});
  },

  async reset(c) {
    const body = await c.req.json();
    const { code, username, password } = body;
    const u = c.get("user");
    try {
      let id;
      let user;

      if (u.username !== config.admin) fail("disabled");
      id = await g(`user:${username.toLowerCase().replace(/\s/g, "")}`);
      user = await g(`user:${id}`);

      if (!user) fail("user not found");

      warn("password reset", user.username, code, c.req.header("cf-connecting-ip"));

      user.pin = null;
      user.nsec = null;
      user.authPubkey = null;

      user.password = await Bun.password.hash(password, {
        algorithm: "bcrypt",
        cost: 4,
      });

      await s(`user:${id}`, user);
      await db.del(`reset:${code}`);

      const un = username.toLowerCase().replace(/\s/g, "");
      await db.del(`${un}:failures`);

      for await (const k of db.scanIterator({ MATCH: "ip:*:login:fail" })) {
        await db.del(k);
      }

      return c.json(pick(user, whitelist));
    } catch (e) {
      err("password reset failed", e.message, c.req.header("cf-connecting-ip"));
      return bail(c, e.message);
    }
  },

  async printerlogin(c) {
    const body = await c.req.json();
    const { username, topic } = body;
    if (username === topic) return c.json({ ok: true });
    else return bail(c, "unauthorized");
  },

  async acl(c) {
    const body = await c.req.json();
    const { username, topic } = body;
    if (username === topic) return c.json({ ok: true });
    else return bail(c, "unauthorized");
  },

  async superuser(c) {
    const body = await c.req.json();
    const { username } = body;
    if (username === config.mqtt2.username) return c.json({ ok: true });
    else return bail(c, "unauthorized");
  },

  async request(c) {
    const body = await c.req.json();
    const { email } = body;
    const user = c.get("user");
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

      return c.json({ ok: true });
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async verify(c) {
    const code = c.req.param("code");
    try {
      const { id, email } = await g(`verify:${code}`);
      if (!id) fail("verification failed");
      const user = await g(`user:${id}`);
      user.email = email;
      user.verified = true;
      await s(`user:${id}`, user);
      await s(`email:${email.toLowerCase()}`, id);

      return c.json(pick(user, fields));
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async forgot(c) {
    const body = await c.req.json();
    const { email } = body;
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

      return c.json({});
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async hidepay(c) {
    const body = await c.req.json();
    const { username } = body;
    const u = await getUser(username);
    u.hidepay = true;
    await s(`user:${u.id}`, u);
    return c.json({});
  },

  async unlimit(c) {
    const body = await c.req.json();
    const { username } = body;
    const u = await getUser(username);
    u.unlimited = true;
    await s(`user:${u.id}`, u);
    return c.json({});
  },

  async account(c) {
    const id = c.req.param("id");
    const { id: uid } = c.get("user");

    const pos = await db.lPos(`${uid}:accounts`, id);
    if (pos == null) fail("account not found");

    const account = await g(`account:${id}`);
    if (account) account.balance = await getBalance(id);
    return c.json(account);
  },

  async accounts(c) {
    try {
      const user = c.get("user");

      const accountIds = (await db.lRange(`${user.id}:accounts`, 0, -1)) as string[];
      const accountKeys = accountIds.map((aid) => `account:${aid}`);
      const accountData = await gfAll(accountKeys);

      const accounts = [];
      for (let i = 0; i < accountIds.length; i++) {
        const aid = accountIds[i];
        const account = accountData[i];
        if (!account) continue;

        if ((account.seed || user.seed) && account.pubkey && !account.importedAt) {
          await importAccountHistory(account);
        }

        if (account.type === PaymentType.ark || (account.pubkey && account.fingerprint)) {
          const paymentIds = (await db.lRange(`${aid}:payments`, 0, -1)) as string[];
          const paymentKeys = paymentIds.map((pid) => `payment:${pid}`);
          const payments = await gfAll(paymentKeys);
          let sum = 0;
          let pending = 0;
          for (const pay of payments) {
            if (!pay) continue;
            if (pay.confirmed === false) pending += pay.amount;
            else sum += pay.amount - (pay.fee || 0);
          }
          account.balance = Math.max(sum, 0);
          account.pending = Math.max(pending, 0);
        } else {
          account.balance = await getBalance(aid);
          account.pending = await getPending(aid);
        }
        accounts.push(account);
      }

      return c.json(accounts.reverse());
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async createAccount(c) {
    try {
      const body = await c.req.json();
      const { fingerprint, pubkey, name, seed, type, arkAddress, accountIndex } = body;
      const user = c.get("user");
      const { id: uid } = user;

      const id = v4();
      const account = {
        id,
        name,
        seed,
        type,
        uid,
        pubkey,
        fingerprint,
        descriptors: [] as any[],
        nextIndex: 0,
        arkAddress,
        accountIndex,
        importedAt: undefined,
      };

      await createBalanceAccount(id);

      if (pubkey && type === "bitcoin") {
        const accountIds = await db.lRange(`${uid}:accounts`, 0, -1);
        for (const accId of accountIds) {
          const acc = await g(`account:${accId}`);
          if (acc?.pubkey === pubkey) {
            return bail(c, "A vault with this key already exists");
          }
        }
      }

      if (type === "ark") {
        const accountIds = await db.lRange(`${user.id}:accounts`, 0, -1);
        for (const accId of accountIds) {
          const acc = await g(`account:${accId}`);
          if (acc?.type === "ark") {
            return bail(c, "You already have an Ark vault");
          }
        }
        const m = db
          .multi()
          .set(`account:${id}`, JSON.stringify(account))
          .lPush(`${user.id}:accounts`, id);
        if (arkAddress) m.set(`arkaddr:${arkAddress}`, JSON.stringify({ aid: id, uid }));
        await m.exec();

        return c.json(account);
      }

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

      if (typeof accountIndex !== "undefined") {
        user.accountIndex = (Number.parseInt(accountIndex) || 0) + 1;
        await s(`user:${uid}`, user);
      }

      await db
        .multi()
        .set(`account:${id}`, JSON.stringify(account))
        .lPush(`${user.id}:accounts`, id)
        .exec();

      return c.json(account);
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async updateAccount(c) {
    const id = c.req.param("id");
    const { id: uid } = c.get("user");
    const body = await c.req.json();
    const { name, autowithdraw, threshold, reserve, destination, currency, fingerprint, pubkey } =
      body;

    const pos = await db.lPos(`${uid}:accounts`, id);
    if (pos == null) fail("account not found");

    const account = await g(`account:${id}`);
    if (name !== undefined) account.name = name;
    if (autowithdraw !== undefined) account.autowithdraw = autowithdraw;
    if (threshold !== undefined) account.threshold = threshold;
    if (reserve !== undefined) account.reserve = reserve;
    if (destination !== undefined) account.destination = destination.trim();
    if (currency !== undefined) account.currency = currency;

    let needsImport = false;
    if (fingerprint !== undefined && pubkey !== undefined) {
      account.fingerprint = fingerprint;
      account.pubkey = pubkey;
      account.importedAt = null;
      needsImport = true;
    }

    await s(`account:${id}`, account);

    if (needsImport) {
      importAccountHistory(account)
        .then(() => {
          emit(uid, "payment", { aid: id, type: "import" });
        })
        .catch((e) => console.error("importAccountHistory failed:", e.message));
    }

    return c.json(account);
  },

  async deleteAccount(c) {
    try {
      const body = await c.req.json();
      const { id } = body;
      const { id: uid } = c.get("user");
      l("deleteAccount", id, "uid:", uid);
      const account = await g(`account:${id}`);
      l("deleteAccount account:", !!account, "type:", account?.type);
      if (!account) fail("account not found");

      // Support both list and set storage for accounts
      const keyType = await db.type(`${uid}:accounts`);
      if (keyType === "list") {
        const pos = await db.lPos(`${uid}:accounts`, id);
        if (pos == null) fail("account not found");
      } else if (keyType === "set") {
        const isMember = await db.sIsMember(`${uid}:accounts`, id);
        if (!isMember) fail("account not found");
      } else {
        fail("account not found");
      }

      if (account.type !== "ark") {
        try {
          const node = rpc({ ...config[account.type], wallet: id });
          await node.unloadWallet(id);
        } catch (e) {
          warn("failed to unload wallet", id);
        }
      }

      const m = db.multi();
      if (keyType === "list") m.lRem(`${uid}:accounts`, 1, id);
      else if (keyType === "set") m.sRem(`${uid}:accounts`, id);
      m.del(`account:${id}`).del(`${id}:payments`);
      if (account.arkAddress) m.del(`arkaddr:${account.arkAddress}`);
      await m.exec();

      return c.json({ ok: true });
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async deleteUser(c) {
    try {
      const user = c.get("user");
      const { id, username, pubkey } = user;
      l("deleteUser", username, id);

      // Remove app created during registration
      const appKeys = await db.sMembers(`${id}:apps`);
      const m = db.multi();
      for (const key of appKeys) {
        m.del(`app:${key}`);
      }

      // Reverse everything register() created
      m.del(`user:${id}`)
        .del(`user:${username}`)
        .del(`account:${id}`)
        .del(`${id}:accounts`)
        .del(`${id}:apps`);

      if (pubkey) {
        m.del(`user:${pubkey}`)
          .del(`${pubkey}:follows:n`)
          .del(`${pubkey}:followers:n`)
          .del(`${pubkey}:pubkeys`);
      }

      await m.exec();

      l("deleted user", username);
      return c.json({ ok: true });
    } catch (e) {
      err("problem deleting user", e.message);
      return bail(c, e.message);
    }
  },

  async flash(c) {
    const body = await c.req.json();
    const { ssid, key, token } = body;
    const cfg = `${ssid.trim()}\n${key.trim()}\n${token.trim()}\n`;
    await writeFile("./printer/config.txt", cfg, "utf8");
    await $`./mklittlefs -c ./printer -p 256 -b 4096 -s 0x20000 ./littlefs.img`;
    return new Response(Bun.file("./littlefs.img"), {
      headers: { "Content-Type": "application/octet-stream" },
    });
  },

  async app(c) {
    const pubkey = c.req.param("pubkey");
    const user = c.get("user");
    const app = await g(`app:${pubkey}`);
    if (app.uid !== user.id) fail("unauthorized");

    const lud16 = `${user.username}@${host}`;

    const pids = (await db.lRange(`${pubkey}:payments`, 0, -1)) || [];

    const payments = await Promise.all(
      pids.map(async (pid) => {
        const p = await gf(`payment:${pid}`);
        if (p) p.user = await g(`user:${p.uid}`);
        return p;
      }),
    );

    app.nwc = `nostr+walletconnect://${serverPubkey2}?relay=${relay}&secret=${app.secret}&lud16=${lud16}`;
    app.payments = payments.filter((p) => p);

    return c.json(app);
  },

  async apps(c) {
    const user = c.get("user");
    const pubkeys = [...await db.sMembers(`${user.id}:apps`)];
    const apps = await Promise.all(pubkeys.map((p) => g(`app:${p}`)));

    const lud16 = `${user.username}@${host}`;

    await Promise.all(
      apps.map(async (a) => {
        if (a.secret)
          a.nwc = `nostr+walletconnect://${serverPubkey2}?relay=${relay}&secret=${a.secret}&lud16=${lud16}`;

        const pids = await db.lRange(`${a.pubkey}:payments`, 0, -1);
        let payments = await Promise.all(pids.map((pid) => gf(`payment:${pid}`)));
        payments = payments.filter((p) => p);
        a.spent = payments.reduce(
          (a, b) =>
            a +
            (Math.abs(Number.parseInt(b.amount || 0)) +
              Number.parseInt(b.fee || 0) +
              Number.parseInt(b.ourfee || 0)),
          0,
        );
      }),
    );

    return c.json(apps);
  },

  async updateApp(c) {
    try {
      const body = await c.req.json();
      let { secret, pubkey, max_amount, max_fee, budget_renewal, name, notify } = body;

      const user = c.get("user");
      const uid = user.id;
      let app = await g(pubkey);

      if (app && uid !== app.uid) fail("Unauthorized");
      if (secret) pubkey = getPublicKey(hexToBytes(secret));
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

      return c.json({});
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async deleteApp(c) {
    try {
      const user = c.get("user");
      const uid = user.id;
      const body = await c.req.json();
      const { pubkey } = body;
      const app = await g(`app:${pubkey}`);
      if (app && uid !== app.uid) {
        warn(app.uid, uid);
        fail("Unauthorized");
      }
      await db.sRem(`${uid}:apps`, pubkey);
      await db.del(`app:${pubkey}`);
      return c.json({});
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async addPin(c) {
    const { id: uid } = c.get("user");
    const body = await c.req.json();
    const { id } = body;
    await db.sAdd(`${uid}:pins`, id);
    return c.json({});
  },

  async deletePin(c) {
    const { id: uid } = c.get("user");
    const body = await c.req.json();
    const { id } = body;
    await db.sRem(`${uid}:pins`, id);
    return c.json({});
  },

  async trust(c) {
    const { id } = c.get("user");
    return c.json(await db.sMembers(`${id}:trust`));
  },

  async addTrust(c) {
    const { id: uid } = c.get("user");
    const body = await c.req.json();
    const { id } = body;
    await db.sAdd(`${uid}:trust`, id);
    return c.json({});
  },

  async deleteTrust(c) {
    const { id: uid } = c.get("user");
    const body = await c.req.json();
    const { id } = body;
    await db.sRem(`${uid}:trust`, id);
    return c.json({});
  },

  async passkeyRegisterOptions(c) {
    try {
      const user = c.get("user");
      const body = await c.req.json();
      const origin = body.origin || `https://${config.hostname}`;
      const options = await generatePasskeyRegistration(user, origin);
      return c.json(options);
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async passkeyRegisterVerify(c) {
    try {
      const user = c.get("user");
      const body = await c.req.json();
      const origin = body.origin || `https://${config.hostname}`;
      const credential = await verifyPasskeyRegistration(user, body, origin);
      if (!user.passkeys) user.passkeys = [];
      user.passkeys.push(credential);
      await s(`user:${user.id}`, user);
      return c.json({ ok: true });
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async passkeyLoginOptions(c) {
    try {
      const body = await c.req.json();
      const origin = body.origin || `https://${config.hostname}`;
      const options = await generatePasskeyLogin(origin);
      return c.json(options);
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async passkeyLoginVerify(c) {
    try {
      const body = await c.req.json();
      const { credential, challengeId, origin: reqOrigin } = body;
      const origin = reqOrigin || `https://${config.hostname}`;
      const user = await verifyPasskeyLogin(credential, challengeId, origin);
      const payload = { id: user.id };
      const token = jwt.sign(payload, config.jwt);
      return c.json({ user: pick(user, whitelist), token });
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async credits(c) {
    const { id } = c.get("user");
    const bitcoin = await getCredit(id, "bitcoin");
    const lightning = await getCredit(id, "lightning");
    const liquid = await getCredit(id, "liquid");
    return c.json({ bitcoin, lightning, liquid });
  },

  async ro(c) {
    const user = c.get("user");
    const payload = { id: `${user.id}-ro` };
    const token = jwt.sign(payload, config.jwt);
    return c.json(token);
  },
};
