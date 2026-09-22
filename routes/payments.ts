import config from "$config";
import api from "$lib/api";
import { requirePin } from "$lib/auth";
import { archive, db, g, gf, s, sa } from "$lib/db";
import { generate, getUserOffer } from "$lib/invoices";
import { replay } from "$lib/lightning";
import ln from "$lib/ln";
import { platformFee, quoteMax, quoteRoutingFee } from "$lib/lnquote";
import { err, l, shortError, warn } from "$lib/logging";
import mqtt from "$lib/mqtt";
import {
  build,
  completePayment,
  credit,
  debit,
  decode,
  sendInternal,
  sendLightning,
  sendOnchain,
} from "$lib/payments";
import { emit } from "$lib/sockets";
import { PaymentType } from "$lib/types";
import {
  SATS,
  bail,
  fail,
  fields,
  getInvoice,
  getPayment,
  getUser,
  sats,
} from "$lib/utils";
import rpc from "@coinos/rpc";
import got from "got";
import { v4 } from "uuid";

export default {
  async info(_, res) {
    res.send(await ln.getinfo());
  },

  async create(req, res) {
    const { body, user } = req;

    let { amount, hash, fee, fund, memo, payreq } = body;
    const balance = await g(`balance:${user.id}`);

    try {
      // Reject non-string payreq/hash up front. A client sending a number/object
      // here otherwise reaches a decoder that calls `.startsWith` on it and throws
      // an opaque "n.startsWith is not a function" (logged bare via the catch
      // below). A malformed *string* is fine — it fails later with a clear error.
      if (payreq != null && typeof payreq !== "string")
        fail("Invalid payment request");
      if (hash != null && typeof hash !== "string") fail("Invalid invoice");

      if (typeof amount !== "undefined") {
        amount = Number.parseInt(amount);
        if (amount < 0 || amount > SATS || Number.isNaN(amount))
          fail("Invalid amount");
      }

      await requirePin({ body, user });

      let p;

      const invoice = await getInvoice(payreq || hash);
      const recipient = invoice ? await getUser(invoice.uid) : undefined;
      if (payreq) {
        if (invoice) {
          if (invoice.aid === user.id) fail("Cannot send to self");
          hash = payreq;
          if (!amount) ({ amount } = invoice);
        } else {
          p = await sendLightning({ user, pr: payreq, amount, fee, memo });
        }
      }

      if (!p) {
        if (hash) {
          p = await sendInternal({
            invoice,
            amount,
            memo,
            recipient,
            sender: user,
          });
        } else if (fund) {
          p = await debit({
            hash,
            amount,
            memo: fund,
            user,
            type: PaymentType.fund,
          });
          await db.incrBy(`fund:${fund}`, amount);
          await db.lPush(`fund:${fund}:payments`, p.id);
          l("funded fund", fund);
        }
      }

      res.send(p);
    } catch (e) {
      warn(user.username, "payment failed", amount, balance, hash, payreq);
      err(shortError(e.message));
      bail(res, e.message);
    }
  },

  async list(req, res) {
    let {
      user: { id },
      query: { aid, start, end, limit, offset, received },
    } = req;
    if (!aid || aid === "undefined") aid = id;

    const index = await db.lPos(`${id}:accounts`, aid);
    if (index === null) fail("unauthorized");

    limit = Number.parseInt(limit);
    offset = Number.parseInt(offset) || 0;

    const range = !limit || received || start || end ? -1 : limit - 1;
    const listKey = `${aid || id}:payments`;
    let payments = (await db.lRange(listKey, 0, range)) || [];

    if (range === -1) {
      const archived = (await archive.lRange(listKey, 0, -1)) || [];
      payments = [...new Set([...payments, ...archived])];
    } else if (limit) {
      const needed = Math.max(0, limit + offset - payments.length);
      if (needed > 0) {
        const archived =
          (await archive.lRange(listKey, 0, limit + offset - 1)) || [];
        payments = [...new Set([...payments, ...archived])];
      }
    }

    payments = (
      await Promise.all(
        payments.map(async (pid) => {
          const p = await gf(`payment:${pid}`);
          if (!p) {
            warn("user", id, "missing payment", pid);
            return;
          }
          if (p.revertedDuplicate) return;
          if (received && p.amount < 0) return;
          if (p.created < start || p.created > end) return;
          if (p.type === PaymentType.internal)
            p.with = await getUser(p.ref, fields);
          return p;
        }),
      )
    )
      .filter((p) => p)
      .sort((a, b) => b.created - a.created);

    const fn = (a, b) => ({
      ...a,
      [b.currency]: {
        tips: (a[b.currency] ? a[b.currency].tips : 0) + (b.tip || 0),
        fiatTips: (
          Number.parseFloat(a[b.currency] ? a[b.currency].fiatTips : 0) +
          ((b.tip || 0) * b.rate) / SATS
        ).toFixed(2),
        sats:
          (a[b.currency] ? a[b.currency].sats : 0) +
          (b.amount || 0) +
          (b.tip || 0) -
          (b.fee || 0) -
          (b.ourfee || 0),
        fiat: (
          Number.parseFloat(a[b.currency] ? a[b.currency].fiat : 0) +
          (((b.amount || 0) +
            ((b.amount > 0 ? b.tip : -b.tip) || 0) -
            (b.fee || 0) -
            (b.ourfee || 0)) *
            b.rate) /
            SATS
        ).toFixed(2),
      },
    });

    const incoming = payments.filter((p: any) => p.amount > 0).reduce(fn, {});
    const outgoing = payments.filter((p: any) => p.amount < 0).reduce(fn, {});

    const { length: count } = payments;
    if (limit) payments = payments.slice(offset, offset + limit);

    res.send({ payments, count, incoming, outgoing });
  },

  async get(req, res) {
    try {
      const {
        params: { hash },
      } = req;
      const p = await getPayment(hash);
      if (p?.type === PaymentType.internal)
        p.with = await getUser(p.ref, fields);
      if (p?.type === PaymentType.fund) p.with = await getUser(p.uid, fields);
      res.send(p);
    } catch (e) {
      err("failed to get payment", e.message);
      bail(res, e.message);
    }
  },

  async parse(req, res) {
    const {
      body: { payreq },
      user,
    } = req;
    try {
      const hour = 1000 * 60 * 60;
      let nodes = await g("nodes");
      const { last } = nodes || {};

      if (!last || last > Date.now() - hour) {
        ({ nodes } = await ln.listnodes());
        nodes.last = Date.now();
        await s("nodes", nodes);
      }

      const decoded = await ln.decode(payreq);

      let amount_msat;
      let payee;

      if (decoded.type === "bolt12 offer") {
        ({ offer_amount_msat: amount_msat } = decoded);
        payee = decoded.offer_issuer_id || decoded.offer_node_id;
      } else if (decoded.type.includes("bolt12")) {
        ({ invoice_amount_msat: amount_msat, invoice_node_id: payee } =
          decoded);
      } else ({ amount_msat, payee } = decoded);

      const node = nodes.find((n) => n.nodeid === payee);
      const alias = node ? node.alias : (payee || "").substr(0, 12);

      const amount = Math.round((amount_msat || 0) / 1000);
      let ourfee = Math.round(amount * config.fee[PaymentType.lightning]);
      const credit = await g(`credit:lightning:${user.id}`);
      const covered = Math.min(credit, ourfee) || 0;
      ourfee -= covered;

      res.send({
        alias,
        amount,
        ourfee,
        type: decoded.type,
        description: decoded.offer_description || decoded.description,
      });
    } catch (e) {
      err("problem parsing", e.message);
      bail(res, e.message);
    }
  },

  async fund(req, res) {
    const {
      params: { id },
    } = req;
    let amount = await g(`fund:${id}`);
    let fid = id;

    // A rotated fund no longer exists at its OLD id (security fix 2026-08-25:
    // fund secret uids were rotated to invalidate an exfiltrated id list). Serve
    // the new fund ONLY to an authenticated MANAGER of it — never anonymously or
    // to a non-owner. An open old->new redirect would defeat the rotation, since
    // the attacker holds the leaked OLD ids; gating on manager membership means a
    // replayed old id reveals nothing unless you already control the fund. The
    // route's `optional` auth populates req.user without requiring it. Bearer
    // funds (no managers) are intentionally not recoverable this way.
    if (typeof amount === "undefined" || amount === null) {
      const rotatedTo = await g(`fund:rotated:${id}`);
      const uid = req.user?.id;
      if (rotatedTo && uid && (await db.sIsMember(`fund:${rotatedTo}:managers`, uid))) {
        fid = rotatedTo;
        amount = await g(`fund:${rotatedTo}`);
      }
    }

    if (typeof amount === "undefined" || amount === null)
      return bail(res, "fund not found");

    let payments = (await db.lRange(`fund:${fid}:payments`, 0, -1)) || [];
    payments = await Promise.all(payments.map((hash) => gf(`payment:${hash}`)));

    await Promise.all(
      payments.map(async (p: any) => (p.user = await getUser(p.uid, fields))),
    );

    payments = payments.filter((p) => p);

    const authorization = await g(`authorization:${fid}`);
    res.send({
      amount,
      authorization: authorization?.amount,
      payments,
      ...(fid !== id ? { id: fid, rotatedFrom: id } : {}),
    });
  },

  // async withdraw(req, res) {
  //   const {
  //     params: { name },
  //   } = req;
  //   const { user } = req;
  //   const balance = await g(`fund:${name}`);
  //   const managers = await db.sMembers(`fund:${name}:managers`);
  //   if (managers.length && !managers.includes(user.id)) fail("Unauthorized");
  //   res.send({
  //     tag: "withdrawRequest",
  //     callback: `${URL}/api/lnurlw`,
  //     k1: name,
  //     defaultDescription: `Withdraw from coinos fund ${name}`,
  //     minWithdrawable: balance > 0 ? 1000 : 0,
  //     maxWithdrawable: balance * 1000,
  //   });
  // },

  async authorize(req, res) {
    // Kill-switch for the fund/authorize/take mechanism (SECURITY 2026-08-25:
    // the /take fund-claim path could pay out unbacked balance). Set redis
    // `fund:disabled` to fail all
    // fund authorizations closed while the mechanism is audited/rewritten.
    if (await g("fund:disabled")) fail("Fund transfers temporarily disabled");

    const { id: uid } = req.user;
    const { id, fiat, currency, amount } = req.body;

    const managers = await db.sMembers(`fund:${id}:managers`);
    if (managers.length && !managers.includes(uid)) fail("Unauthorized");

    // The authorization's fiat/currency is the ONLY ceiling on how much a later
    // /take can pull from the authorizer (cap = sats(fiat / rates[currency])).
    // Reject a NaN/zero/non-finite rate or a non-positive fiat so the ceiling
    // can never be turned into an astronomically large or non-finite value.
    const rates = await g("rates");
    const rate = Number(rates?.[currency]);
    const fiatAmount = Number(fiat);
    if (!Number.isFinite(rate) || rate <= 0) fail("Invalid currency");
    if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) fail("Invalid amount");

    const authorization = {
      uid,
      currency,
      fiat: fiatAmount,
      amount: Number.parseInt(amount) || 0,
    };

    await s(`authorization:${id}`, authorization);
    res.send({});
  },

  async take(req, res) {
    let {
      body: { id, amount, invoice: iid },
      user,
    } = req;
    try {
      // Kill-switch — see authorize().
      if (await g("fund:disabled")) fail("Fund transfers temporarily disabled");

      amount = Number.parseInt(amount);
      if (!Number.isFinite(amount) || amount <= 0) fail("Invalid amount");

      const rates = await g("rates");

      if (!iid) {
        const inv = await generate({
          invoice: { amount, type: "lightning" },
          user,
        });
        iid = inv.id;
      }

      const authorization = await g(`authorization:${id}`);
      if (authorization && !authorization.claimed) {
        const { currency, fiat } = authorization;
        // Bound the take to the authorized fiat value using a VALIDATED fiat
        // rate. A non-finite/zero rate or a crypto-denominated authorization
        // (rate ~1) would otherwise make sats(fiat / rate) an astronomically
        // large ceiling, defeating the cap (the drain vector).
        const rate = Number(rates?.[currency]);
        const fiatAmount = Number(fiat);
        if (!Number.isFinite(rate) || rate <= 0)
          fail("Invalid authorization currency");
        if (!Number.isFinite(fiatAmount) || fiatAmount <= 0)
          fail("Invalid authorization amount");
        const cap = sats(fiatAmount / rate);
        if (!Number.isFinite(cap) || cap <= 0) fail("Invalid authorization");
        amount = Math.min(amount, cap);
        if (!Number.isFinite(amount) || amount <= 0) fail("Invalid amount");

        // Atomic single-use claim. The read above is not a lock: concurrent
        // POST /take for the same authorization all pass the `!claimed` gate and,
        // without an atomic gate, each would debit the authorizer and fund the
        // pool — redeeming a single-use authorization N times (COINOS-3). SET NX
        // lets exactly one caller win the claim; the rest skip the funding.
        const claimed = await db.set(`authorization:${id}:claimed`, user.id, {
          NX: true,
        });
        if (claimed) {
          // Mark the record claimed only once the funding has actually landed,
          // and release the claim if it throws — otherwise a failed funding
          // (an insufficient balance, a server limit) burns the authorization
          // permanently: the key is set, the fund never gets the money, and
          // every later /take skips the funding block.
          try {
            const sender = await getUser(authorization.uid);
            if (!sender) fail("authorizer not found");

            const { hash } = await generate({
              invoice: { amount, type: "lightning" },
              user: sender,
            });

            const { id: pid } = await debit({
              hash,
              amount,
              memo: id,
              user: sender,
              type: PaymentType.fund,
            });

            await db.incrBy(`fund:${id}`, amount);
            await db.lPush(`fund:${id}:payments`, pid);

            authorization.claimed = true;
            await s(`authorization:${id}`, authorization);
            l("funded fund", id);
          } catch (e) {
            await db.del(`authorization:${id}:claimed`);
            throw e;
          }
        }
      }

      const managers = await db.sMembers(`fund:${id}:managers`);
      if (managers.length && !managers.includes(user.id)) fail("Unauthorized");

      const result: any = await db.debit(
        `fund:${id}`,
        "",
        "Insufficient funds",
        amount,
        0,
        0,
        0,
        0,
      );
      if (result.err) fail(result.err);

      const payment = await credit({
        aid: user.id,
        hash: iid,
        amount,
        memo: id,
        ref: id,
        type: PaymentType.fund,
      });

      await db.lPush(`fund:${id}:payments`, payment.id);

      res.send(payment);
    } catch (e) {
      warn("problem withdrawing from fund", user.username, e.message);
      bail(res, e.message);
    }
  },

  async managers(req, res) {
    const { name } = req.params;

    const ids = await db.sMembers(`fund:${name}:managers`);

    const managers = (await Promise.all(
      ids.map(async (id) => await getUser(id, fields)),
    )).filter(Boolean);

    res.send(managers);
  },

  async addManager(req, res) {
    const { id, username } = req.body;
    const { user } = req;

    const k = `fund:${id}:managers`;

    let managers = await db.sMembers(k);
    if (managers.length) {
      if (!managers.includes(user.id)) fail("Unauthorized");
    } else {
      await db.sAdd(k, user.id);
    }

    const u = await getUser(username, fields);
    if (!u) fail("User not found");
    const { id: uid } = u;

    await db.sAdd(k, uid);

    const ids = await db.sMembers(k);
    const resolved = (await Promise.all(
      ids.map(async (id) => await getUser(id, fields)),
    )).filter(Boolean);

    res.send(resolved);
  },

  async deleteManager(req, res) {
    try {
      const { name } = req.params;
      const { id: uid } = req.body;
      const { user } = req;

      const k = `fund:${name}:managers`;
      let managers = await db.sMembers(k);

      if (managers.length) {
        if (!managers.includes(user.id)) fail("Unauthorized");
      }

      await db.sRem(k, uid);

      const ids = await db.sMembers(k);
      managers = await Promise.all(
        ids.map(async (id) => await getUser(id, fields)),
      );

      res.send(managers);
    } catch (e) {}
  },

  async confirm(req, res) {
    const {
      body: { txid, wallet, type },
    } = req;

    try {
      const node = rpc({ ...config[type], wallet });
      const { confirmations, details } = await node.getTransaction(txid);
      const hot = wallet === config[type].wallet;
      let aid;
      if (!hot) aid = wallet;

      // Change-recredit guard (2026-08-18). If our own wallet contributed inputs
      // to this transaction, a "send" detail is present. In that case every
      // receive output is our own CHANGE or an internal move — never an external
      // deposit — so it must not be credited: doing so mints phantom balance
      // (the withdrawal-change re-credit exploit that drove the L-C creep). A
      // genuine coinos->coinos transfer is settled off-chain in the send path
      // (credit() resolves getInvoice(hash) and books an internal transfer), so
      // an on-chain receive funded by our own spend is only ever change.
      const weSpent = details.some((d: any) => d.category === "send");

      for (const { address, amount, asset, category, vout } of details) {
        if (!address) continue;
        if (type === PaymentType.liquid && asset !== config.liquid.btc)
          continue;

        // Kill switch: `liquid:deposits:disabled` stops every Liquid receive
        // from being credited or confirmed (sends still get their
        // confirmation bookkeeping below). Set during a security incident;
        // clear the key to re-enable.
        if (
          type === PaymentType.liquid &&
          category !== "send" &&
          (await g("liquid:deposits:disabled"))
        ) {
          warn("liquid deposit blocked (disabled)", txid, vout, sats(amount), address);
          continue;
        }

        if (category === "send") {
          const p = await getPayment(txid);
          if (!p) continue;

          if (confirmations) {
            p.confirmed = true;
            await s(`payment:${p.id}`, p);
            if (aid) await db.sRem(`inflight:${aid}`, p.id);
          } else {
            if (aid) await db.sAdd(`inflight:${aid}`, p.id);
          }

          emit(p.uid, "payment", p);
          continue;
        }

        // See weSpent above: a receive output on a transaction our wallet funded
        // is change, not a deposit. Skip it so we never re-credit our own funds.
        // Log the blocked amount as a tripwire: sums the phantom credit prevented
        // and surfaces any continued exploitation attempts.
        if (weSpent) {
          if (sats(amount) >= 300)
            warn("blocked change re-credit", txid, vout, sats(amount), address);
          continue;
        }

        const p = await getPayment(`${txid}:${vout}`);

        if (!p) {
          const invoice = await getInvoice(address);
          if (!hot && aid !== invoice?.aid) continue;
          if (sats(amount) < 300) continue;
          // Atomic first-seen guard (COINOS-2). The getPayment() read above is not
          // a lock: concurrent callers (walletnotify, catchUp, bulk /confirm
          // sweeps — /confirm is unauthenticated) can all read p==null for one
          // deposit and each run credit(), double-crediting the pending balance
          // AND inflating the spendable credit:<net>:<uid> fee accumulator. Mirror
          // the confirm-stage lock so only the first caller credits.
          const firstlock = `firstseenlock:${txid}:${vout}`;
          if (!(await db.set(firstlock, "1", { NX: true, EX: 60 }))) continue;
          await credit({
            hash: address,
            amount: sats(amount),
            ref: `${txid}:${vout}`,
            type,
            aid,
          });
        } else if (confirmations >= 1) {
          const id = `payment:${txid}:${vout}`;
          // Atomic guard against concurrent /confirm callers double-crediting:
          // walletnotify, catchUp, and bulk sweeps can all fire for the same
          // txid:vout in parallel. Without this, two callers can each read
          // p.confirmed=false and each run the multi() that increments balance.
          const lockKey = `confirmlock:${txid}:${vout}`;
          const acquired = await db.set(lockKey, "1", { NX: true, EX: 60 });
          if (!acquired) continue;

          const p = await getPayment(`${txid}:${vout}`);
          if (!p) {
            await db.sAdd("missed", id);
            await db.del(lockKey);
            return;
          }
          if (p.confirmed) {
            await db.del(lockKey);
            return;
          }

          const invoice = await getInvoice(address);
          const { id: iid } = invoice;

          p.confirmed = true;
          invoice.received += Number.parseInt(invoice.pending);
          invoice.pending = 0;

          l("confirming", id, p.id, p.amount);

          await db
            .multi()
            .set(`invoice:${iid}`, JSON.stringify(invoice))
            .set(`payment:${p.id}`, JSON.stringify(p))
            .decrBy(`pending:${p.aid || p.uid}`, p.amount)
            .incrBy(`balance:${p.aid || p.uid}`, p.amount)
            .exec();

          // Mirror the now-confirmed record into arc so a future bulk sweep
          // finds it via gf() fallback even if the main-db pointer is wiped
          // (see feedback_apr29_double_credit_incident.md).
          await sa(`payment:${p.id}`, p);
          await sa(`invoice:${iid}`, invoice);

          await db.del(lockKey);

          const user = await g(`user:${p.uid}`);
          await completePayment(invoice, p, user);
        }
      }
      res.send({});
    } catch (e) {
      warn(`problem processing ${txid}`);
      bail(res, e.message);
    }
  },

  async fee(req, res) {
    const { body, user } = req;
    try {
      res.send(await build({ ...body, user }));
    } catch (e) {
      warn(
        "problem estimating fee",
        e.message,
        user.username,
        body.amount,
        body.address,
      );
      let msg = e.message;
      if (msg.includes("500")) msg = "";
      bail(res, `Failed to prepare transaction ${msg}`);
    }
  },

  async send(req, res) {
    const { body, user } = req;
    try {
      await requirePin({ body, user });
      const { hash: txid } = await sendOnchain({ ...body, user });
      const pid = await g(`payment:${txid}`);
      const p = await g(`payment:${pid}`);

      res.send(p);
    } catch (e) {
      warn(user.username, "payment failed", shortError(e.message));
      res.code(500).send(e.message);
    }
  },

  async freeze(req, res) {
    const {
      body: { secret },
    } = req;
    try {
      if (!config.adminpass || secret !== config.adminpass) fail("unauthorized");
      await s("freeze", true);
      res.send("ok");
    } catch (e) {
      bail(res, e.message);
    }
  },

  async print(req, res) {
    const {
      body: { id },
      user,
    } = req;
    try {
      const p = await gf(`payment:${id}`);
      if (!p) fail("Payment not found");
      if (p.uid !== user.id) fail("unauthorized");
      emit(user.id, "payment", p);

      const { username } = user;

      mqtt.publish(
        username,
        `pay:${p.amount}:${p.tip}:${p.rate}:${p.created}:${p.id}`,
      { qos: 1 },
      );

      res.send({ ok: true });
    } catch (e) {
      bail(res, e.message);
    }
  },

  async lnaddress(req, res) {
    let {
      params: { lnaddress, amount },
      body,
      user,
    } = req;
    const { fee } = body;
    try {
      lnaddress = decodeURIComponent(lnaddress);
      await requirePin({ body, user });

      const [username, domain] = lnaddress.split("@");
      const { minSendable, maxSendable, callback, metadata } = (await got(
        `https://${domain}/.well-known/lnurlp/${username}`,
      ).json()) as any;

      const memo = metadata["text/plain"] || "";
      if (amount * 1000 < minSendable || amount * 1000 > maxSendable)
        fail("amount out of range");

      const r: any = await got(`${callback}?amount=${amount * 1000}`).json();
      if (r.reason) fail(r.reason);
      const { pr } = r;

      const { payee } = await ln.decode(pr);
      const { id } = await ln.getinfo();

      let p;
      if (payee === id) {
        p = await debit({ hash: pr, amount, memo, user });
        await credit({ hash: pr, amount, memo, ref: user.id, tip: p.tip });
      } else p = await sendLightning({ user, pr, amount, fee, memo });

      res.send(p);
    } catch (e) {
      bail(res, e.message);
    }
  },

  async replace(req, res) {
    const {
      body: { id },
      user,
    } = req;
    try {
      const p = await gf(`payment:${id}`);
      if (!p) fail("Payment not found");
      if (p.uid !== user.id) fail("unauthorized");

      const { tx, type } = await decode(p.hex);
      const node = rpc(config[type]);

      const fees: any = await fetch(`${api[type]}/fees/recommended`).then((r) =>
        r.json(),
      );

      const outputs = [];
      for (const {
        scriptPubKey: { address },
        value,
      } of tx.vout) {
        if (address && !(await node.getAddressInfo(address)).ismine)
          outputs.push({ [address]: value });
      }

      const raw = await node.createRawTransaction(tx.vin, outputs);

      const newTx = await node.fundRawTransaction(raw, {
        fee_rate: fees.fastestFee + 50,
        replaceable: true,
        subtractFeeFromOutputs: [],
      });

      const diff = sats(newTx.fee) - p.fee;
      if (diff < 0) fail("fee must increase");

      if (config[type].walletpass)
        await node.walletPassphrase(config[type].walletpass, 300);
      p.hex = (await node.signRawTransactionWithWallet(newTx.hex)).hex;
      const r = await node.testMempoolAccept([p.hex]);
      if (!r[0].allowed) fail(`transaction rejected ${p.hex}`);
      warn("bump", user.username, p.hex);

      res.send({ ok: true });
    } catch (e) {
      err("failed to bump payment", id, e.message);
      bail(res, e.message);
    }
  },

  async internal(req, res) {
    const {
      body: { username, amount },
      user: sender,
    } = req;

    const recipient = await getUser(username);
    res.send(await sendInternal({ amount, sender, recipient }));
  },

  async decode(req, res) {
    const { bolt11 } = req.params;
    res.send(await ln.decode(bolt11));
  },

  // Up-front cost of a lightning send: the routing fee askrene quotes for this
  // invoice (the same answer xpay will get) plus the platform fee debit() will
  // charge. With `max`, instead solve for the largest amount whose amount +
  // fees exactly clears the account balance — the "send everything" case where
  // guessing a maxfee always left dust behind or bounced on insufficient funds.
  async quote(req, res) {
    const { body, user } = req;
    try {
      let { payreq, amount, max, aid, ceiling } = body;
      if (typeof payreq !== "string" || !payreq.trim())
        fail("Invalid payment request");
      payreq = payreq.replace(/\s/g, "").toLowerCase();

      if (!aid) aid = user.id;
      else if (typeof aid !== "string") fail("Invalid account");
      else if (aid !== user.id) {
        const pos = await db.lPos(`${user.id}:accounts`, aid);
        if (pos == null) fail("account not found");
      }

      const parseSats = (v, name) => {
        if (v === undefined || v === null || v === "") return undefined;
        const n = Number.parseInt(v);
        if (Number.isNaN(n) || n < 0 || n > SATS) fail(`Invalid ${name}`);
        return n;
      };
      amount = parseSats(amount, "amount");
      ceiling = parseSats(ceiling, "ceiling");
      const balance = Number.parseInt(await g(`balance:${aid}`)) || 0;

      // Paying another coinos user never leaves the ledger: no routing, no
      // platform fee, the whole balance is sendable.
      const invoice = await getInvoice(payreq);
      if (invoice) {
        const recipient = await getUser(invoice.uid);
        if (recipient?.username !== "mint") {
          const a = max ? balance : (amount ?? invoice.amount);
          return res.send({
            amount: a,
            fee: 0,
            ourfee: 0,
            total: a,
            balance,
            internal: true,
          });
        }
      }

      let decoded = await ln.decode(payreq);
      let pr = payreq;
      let fetched: string | undefined;

      // An offer isn't routable by itself — the blinded paths live in the
      // invoice fetched from it. Fetch one to learn them; in max mode that's a
      // placeholder amount, and the final invoice is fetched once we know the
      // real one so the caller can pay exactly what we quoted.
      const fetchFromOffer = async (a: number) => {
        const { invoice } = await ln.fetchinvoice({
          offer: payreq,
          amount_msat: decoded.offer_amount_msat ? undefined : a * 1000,
          timeout: 60,
        });
        return invoice.replace(/\s/g, "").toLowerCase();
      };

      if (decoded.type === "bolt12 offer") {
        if (decoded.offer_currency)
          fail("Currency-denominated offers are not supported");
        const offerAmount = decoded.offer_amount_msat
          ? Math.round(decoded.offer_amount_msat / 1000)
          : undefined;
        if (offerAmount) max = false;
        const a = offerAmount ?? amount ?? (max ? balance : undefined);
        if (!a) fail("Amount required");
        pr = fetched = await fetchFromOffer(a);
        decoded = await ln.decode(pr);
      }

      let invAmount: number | undefined;
      if (decoded.type === "bolt12 invoice")
        invAmount = decoded.invoice_amount_msat
          ? Math.round(decoded.invoice_amount_msat / 1000)
          : undefined;
      else
        invAmount = decoded.amount_msat
          ? Math.round(decoded.amount_msat / 1000)
          : undefined;

      if (max) {
        // The invoice's own amount is ignored here: an LNURL caller has to
        // name an amount to get any invoice at all, so it probes with one at
        // the ceiling, takes the amount we solve for, and fetches the real
        // invoice for that. Anything that pays a fixed-amount invoice with
        // a different amount fails at send time, not here.
        const q = await quoteMax({ pr, uid: user.id, aid, ceiling });
        // Offer: the placeholder invoice carried the balance, not the answer.
        if (fetched && q.amount !== invAmount) {
          fetched = await fetchFromOffer(q.amount);
          // Re-quote against the real invoice: same paths, so same fee, but
          // never hand back a number we didn't verify against what gets paid.
          const { fee } = await quoteRoutingFee({ pr: fetched, amount: q.amount });
          if (fee !== q.fee) fail("Routing fee changed, please try again");
        }
        return res.send({ ...q, ...(fetched ? { payreq: fetched } : {}) });
      }

      const a = invAmount ?? amount;
      if (!a) fail("Amount required");
      if (invAmount && amount && amount !== invAmount)
        fail("Amount does not match invoice");
      const { fee, parts } = await quoteRoutingFee({ pr, amount: a });
      const ourfee = await platformFee({ uid: user.id, aid, amount: a, fee });
      res.send({
        amount: a,
        fee,
        ourfee,
        parts,
        total: a + fee + ourfee,
        balance,
        ...(fetched ? { payreq: fetched } : {}),
      });
    } catch (e) {
      warn("problem quoting", user.username, shortError(e.message));
      bail(res, e.message);
    }
  },

  // The user's standing bolt12 offer (lno1...) — reusable receive code they
  // can publish (e.g. in a nostr kind 10058 list for bolt12 zaps)
  async offer(req, res) {
    try {
      res.send(await getUserOffer(req.user));
    } catch (e) {
      bail(res, e.message);
    }
  },

  async fetchinvoice(req, res) {
    const { amount, offer, payer_note } = req.body;
    res.send(
      await ln.fetchinvoice({
        offer,
        amount_msat: amount ? amount * 1000 : undefined,
        payer_note,
        timeout: 60,
      }),
    );
  },

  async auth(req, res) {
    console.log(req.query);
    res.send(req.query);
  },

  async order(req, res) {
    console.log(req.body);
    res.send(req.body);
  },

  async sendinvoice(req, res) {
    try {
      const { user } = req;
      const { invreq } = req.body;

      const { amount_msat, bolt12, pay_index } = await ln.sendinvoice({
        invreq,
        label: v4(),
      });

      await generate({
        invoice: {
          amount: Math.round(amount_msat / 1000),
          type: "bolt12",
          bolt12,
        },
        user,
      });

      const p = await replay(pay_index);

      res.send(p);
    } catch (e) {
      bail(res, e.message);
    }
  },
};
