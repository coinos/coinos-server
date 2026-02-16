import config from "$config";
import api from "$lib/api";
import { getArkAddress, sendArk, verifyArkVtxo } from "$lib/ark";
import { requirePin } from "$lib/auth";
import { archive, db, g, gf, s } from "$lib/db";
import { getTx } from "$lib/esplora";
import { generate } from "$lib/invoices";
import { replay } from "$lib/lightning";
import ln from "$lib/ln";
import { err, l, warn } from "$lib/logging";
import mqtt from "$lib/mqtt";
import {
  acquireArkLock,
  build,
  completePayment,
  createArkPayment,
  credit,
  debit,
  decode,
  getUserRate,
  processWatchedTx,
  sendInternal,
  sendLightning,
  sendOnchain,
} from "$lib/payments";
import { emit } from "$lib/sockets";
import { fundDebit, getBalance, getCredit, tbConfirm, tbCredit } from "$lib/tb";
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

    let { amount, hash, fee, fund, memo, payreq, aid } = body;
    const balance = await getBalance(user.id);

    try {
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
        if (invoice && recipient.username !== "mint") {
          if (invoice.aid === (aid || user.id)) fail("Cannot send to self");
          hash = payreq;
          if (!amount) ({ amount } = invoice);
        } else {
          p = await sendLightning({ user, pr: payreq, amount, fee, memo });
        }
      }

      if (!p) {
        if (hash) {
          if (invoice?.type === PaymentType.ark) {
            if (!amount) ({ amount } = invoice);
            if (!invoice.text) fail("Missing ark address");
            const txid = await sendArk(invoice.text, amount);
            p = await debit({
              hash: txid,
              amount,
              memo,
              user,
              type: PaymentType.ark,
              aid,
            });
          } else {
            // Check if recipient account is non-custodial (vault)
            const recipientAccount = invoice?.aid ? await g(`account:${invoice.aid}`) : null;
            if (recipientAccount?.pubkey || recipientAccount?.seed) {
              p = await sendOnchain({
                amount: amount || invoice.amount,
                address: invoice.hash,
                user,
              });
            } else {
              p = await sendInternal({
                invoice,
                amount,
                memo,
                recipient,
                sender: user,
              });
            }
          }
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
      err(e.message);
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
            await db.lRem(listKey, 0, pid);
            return p;
          }
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
      console.log(e);
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

      if (decoded.type.includes("bolt12")) {
        ({ invoice_amount_msat: amount_msat, invoice_node_id: payee } =
          decoded);
      } else ({ amount_msat, payee } = decoded);

      const node = nodes.find((n) => n.nodeid === payee);
      const alias = node ? node.alias : payee.substr(0, 12);

      const amount = Math.round(amount_msat / 1000);
      let ourfee = Math.round(amount * config.fee[PaymentType.lightning]);
      const creditBal = await getCredit(user.id, "lightning");
      const covered = Math.min(creditBal, ourfee) || 0;
      ourfee -= covered;

      res.send({ alias, amount, ourfee });
    } catch (e) {
      console.log(e);
      err("problem parsing", e.message);
      bail(res, e.message);
    }
  },

  async fund(req, res) {
    const {
      params: { id },
    } = req;
    const amount = await g(`fund:${id}`);
    if (typeof amount === "undefined" || amount === null)
      return bail(res, "fund not found");
    let payments = (await db.lRange(`fund:${id}:payments`, 0, -1)) || [];
    payments = await Promise.all(payments.map((hash) => gf(`payment:${hash}`)));

    await Promise.all(
      payments.map(async (p: any) => (p.user = await getUser(p.uid, fields))),
    );

    payments = payments.filter((p) => p);

    const authorization = await g(`authorization:${id}`);
    res.send({ amount, authorization: authorization?.amount, payments });
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
    const { id: uid } = req.user;
    const { id, fiat, currency, amount } = req.body;

    const managers = await db.sMembers(`fund:${id}:managers`);
    if (managers.length && !managers.includes(uid)) fail("Unauthorized");

    const authorization = {
      uid,
      currency,
      fiat,
      amount,
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
      amount = Number.parseInt(amount);
      if (amount < 0) fail("Invalid amount");

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
        amount = Math.min(amount, sats(fiat / rates[currency]));

        const sender = await getUser(authorization.uid);
        authorization.claimed = true;
        await s(`authorization:${id}`, authorization);

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
        l("funded fund", id);
      }

      const managers = await db.sMembers(`fund:${id}:managers`);
      if (managers.length && !managers.includes(user.id)) fail("Unauthorized");

      const result: any = await fundDebit(`fund:${id}`, amount, "Insufficient funds");
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
    if (!managers.length)
      managers = await Promise.all(
        ids.map(async (id) => await getUser(id, fields)),
      );

    res.send(managers);
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

    if (type !== PaymentType.liquid) return res.send({});

    try {
      const node = rpc({ ...config[type], wallet });
      const { confirmations, details } = await node.getTransaction(txid);

      for (const { address, amount, asset, category, vout } of details) {
        if (!address) continue;
        if (asset !== config.liquid.btc) continue;

        if (category === "send") continue;

        const p = await getPayment(`${txid}:${vout}`);

        if (!p) {
          const invoice = await getInvoice(address);
          if (sats(amount) < 300) continue;

          const lockKey = `lock:${txid}:${vout}`;
          const locked = await db.setNX(lockKey, "1");
          if (!locked) continue;
          await db.expire(lockKey, 60);

          await credit({
            hash: address,
            amount: sats(amount),
            ref: `${txid}:${vout}`,
            type,
          });
        } else if (confirmations >= 1) {
          if (p.confirmed) continue;

          const invoice = await getInvoice(address);
          if (!invoice) continue;

          p.confirmed = true;
          invoice.received += Number.parseInt(invoice.pending);
          invoice.pending = 0;

          l("confirming", p.id, p.amount);

          await tbConfirm(p.aid || p.uid, p.amount);

          await db
            .multi()
            .set(`invoice:${invoice.id}`, JSON.stringify(invoice))
            .set(`payment:${p.id}`, JSON.stringify(p))
            .exec();

          const user = await g(`user:${p.uid}`);
          await completePayment(invoice, p, user);
        }
      }
      res.send({});
    } catch (e) {
      console.log(e);
      warn(`problem processing ${txid}`);
      bail(res, e.message);
    }
  },

  async txWebhook(req, res) {
    const { txid, secret } = req.body || {};
    const headerSecret = req.headers["x-hook-secret"];
    const hookSecret = secret || headerSecret;

    try {
      if (config.txWebhookSecret && hookSecret !== config.txWebhookSecret)
        fail("unauthorized");
      if (!txid) fail("missing txid");

      const tx = await getTx(txid);
      await processWatchedTx(tx);

      res.send({});
    } catch (e) {
      warn("problem processing tx webhook", e.message);
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
      warn(user.username, "payment failed", e.message);
      res.code(500).send(e.message);
    }
  },

  async freeze(req, res) {
    const {
      body: { secret },
    } = req;
    try {
      if (secret !== config.adminpass) fail("unauthorized");
      await s("freeze", true);
      res.send("ok");
    } catch (e) {
      console.log(e);
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
        await credit({ hash: pr, amount, memo, ref: user.id });
      } else p = await sendLightning({ user, pr, amount, fee, memo });

      res.send(p);
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async gateway(req, res) {
    const {
      body: { short_channel_id, webhook },
    } = req;

    await s(short_channel_id, webhook);
    res.send({ ok: true });
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

  async fetchinvoice(req, res) {
    const { amount, offer } = req.body;
    res.send(await ln.fetchinvoice(offer, amount ? amount * 1000 : null));
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

  async ark(req, res) {
    const { body, user } = req;
    const { address, amount, aid } = body;

    try {
      await requirePin({ body, user });

      // Check for local custodial receive - do internal transfer
      const vault = await g(`arkaddr:${address}`);
      if (vault) {
        const account = await g(`account:${vault.aid}`);
        if (account?.arkAddress) {
          const iid = await g(`custodial-ark-invoice:${account.arkAddress}`);
          if (iid) {
            const invoice = await getInvoice(iid);
            if (invoice && !invoice.hash) invoice.hash = invoice.id;
            const recipient = await getUser(vault.uid);
            if (recipient && invoice) {
              l("ark local send", user.username, recipient.username, amount);
              const p = await sendInternal({ amount, invoice, recipient, sender: user });
              await db.del(`custodial-ark-invoice:${account.arkAddress}`);
              return res.send(p);
            }
          }
        }
      }

      l("ark send", user.username, address, amount);
      const txid = await sendArk(address, amount);
      l("ark send complete", txid);
      const hash = txid;

      const p = await debit({
        hash,
        amount,
        user,
        type: PaymentType.ark,
        aid,
      });

      res.send(p);
    } catch (e) {
      warn(user.username, "ark payment failed", e.message);
      res.code(500).send(e.message);
    }
  },

  async arkVaultSend(req, res) {
    try {
      const { body, user } = req;
      const { hash, amount, aid } = body;
      const { rate, currency } = await getUserRate(user);

      const p = await createArkPayment({
        aid,
        uid: user.id,
        amount: -amount,
        hash,
        rate,
        currency,
        mapHashToId: true,
      });

      res.send(p);
    } catch (e) {
      bail(res, e.message);
    }
  },

  async arkVaultReceive(req, res) {
    try {
      const { body, user } = req;
      const { amount, hash, aid } = body;

      if (amount <= 0) fail("Invalid amount");
      await acquireArkLock(hash);
      const { rate, currency } = await getUserRate(user);

      const p = await createArkPayment({
        aid,
        uid: user.id,
        amount,
        hash,
        rate,
        currency,
      });

      res.send(p);
    } catch (e) {
      bail(res, e.message);
    }
  },

  async arkAddress(_, res) {
    res.send(await getArkAddress());
  },

  async arkReceive(req, res) {
    try {
      const { body, user } = req;
      const { iid, amount, hash } = body;
      const { id: uid } = user;

      if (amount <= 0) fail("Invalid amount");

      const invoice = await getInvoice(iid);
      if (invoice.uid !== user?.id) fail("Unauthorized");

      let { aid, type, currency } = invoice;

      if (hash) {
        await acquireArkLock(hash);

        // Skip VTXO verification for vault→custodial (same user, debit handled by arkVaultSend)
        if (!(aid && aid !== uid)) {
          if (!(await verifyArkVtxo(hash)))
            fail("VTXO not found in server wallet");
        }
      }

      invoice.received += amount;
      const { rates } = await getUserRate(user);
      const rate = rates[currency];

      // Always credit custodial balance (Ark funds received by server)
      await tbCredit(uid, uid, type, amount, false);

      const p = await createArkPayment({
        aid: uid,
        uid,
        amount,
        hash,
        rate,
        currency,
        type,
        iid,
        extraMultiOps: (m, p) => {
          m.set(`invoice:${invoice.id}`, JSON.stringify(invoice));
          if (hash) m.set(`payment:${aid}:${hash}`, p.id);
        },
      });

      await completePayment(invoice, p, user);

      // Clean up custodial ark invoice index
      if (invoice.text) await db.del(`custodial-ark-invoice:${invoice.text}`);

      res.send(p);
    } catch (e) {
      bail(res, e.message);
    }
  },

  async arkSync(req, res) {
    try {
      const { user } = req;
      const { transactions = [], aid } = req.body;
      const { id: uid } = user;
      l("arkSync", user.username, aid, "txs:", transactions.length, "bal:", req.body.balance);

      // Per-account lock prevents concurrent syncs from racing
      const lockKey = `arksynclock:${aid}`;
      const gotLock = await db.set(lockKey, "1", { NX: true, EX: 30 });
      if (!gotLock) return res.send({ synced: 0, received: 0, payments: [] });

      try {
        const { rate, currency } = await getUserRate(user);

        let synced = 0;
        let received = 0;
        const payments = [];

        for (const tx of transactions) {
          const hashes = [tx.arkTxid, tx.commitmentTxid, tx.hash].filter(Boolean);
          if (!hashes.length) continue;

          // Check if any hash is already known
          let found = false;
          for (const h of hashes) {
            const existingId = await g(`payment:${aid}:${h}`);
            if (existingId) {
              const existing = await g(`payment:${existingId}`);
              if (existing && !existing.confirmed && tx.settled) {
                existing.confirmed = true;
                await s(`payment:${existingId}`, existing);
              }
              found = true;
              break;
            }
          }
          if (found) continue;

          const primaryHash = hashes[0];

          const p = await createArkPayment({
            aid,
            uid,
            amount: tx.amount,
            hash: primaryHash,
            rate,
            currency,
            created: tx.createdAt,
            extraHashMappings: hashes,
          });

          payments.push(p);
          synced++;
          if (tx.amount > 0) {
            received += tx.amount;

            // Find an unpaid ark invoice for this account and mark it received
            const invoiceIds = await db.lRange(`${aid}:invoices`, 0, 20);
            for (const iid of invoiceIds) {
              const inv = await getInvoice(iid);
              if (!inv || inv.type !== "ark") continue;
              if (inv.received >= inv.amount && inv.amount > 0) continue;
              if (inv.amount > 0 && tx.amount < inv.amount) continue;
              inv.received += tx.amount;
              p.iid = iid;
              await s(`invoice:${iid}`, inv);
              await s(`payment:${p.id}`, p);
              emit(uid, "payment", p);
              break;
            }
          }
        }

        // Reconcile expired VTXOs
        const { balance } = req.body;
        if (typeof balance === "number" && balance >= 0) {
          const paymentIds = await db.lRange(`${aid}:payments`, 0, -1);
          let expectedBalance = 0;
          for (const pid of paymentIds) {
            const pay = await g(`payment:${pid}`);
            if (pay) expectedBalance += pay.amount;
          }

          if (expectedBalance > balance) {
            const p = await createArkPayment({
              aid,
              uid,
              amount: balance - expectedBalance,
              hash: `expired-${Date.now()}`,
              rate,
              currency,
              created: Date.now(),
              extraHashMappings: [],
            });
            p.memo = "expired";
            await s(`payment:${p.id}`, p);
            payments.push(p);
            synced++;
          }
        }

        // Check for pending custodial ark invoice to forward
        let forward;
        if (received > 0) {
          const account = await g(`account:${aid}`);
          l("arkSync forward check", aid, account?.arkAddress, received);
          if (account?.arkAddress) {
            const iid = await g(`custodial-ark-invoice:${account.arkAddress}`);
            l("arkSync custodial invoice lookup", account.arkAddress, iid);
            if (iid) {
              const inv = await getInvoice(iid);
              if (inv && (inv.received < inv.amount || inv.amount === 0)) {
                const serverArkAddress = await getArkAddress();
                forward = {
                  iid,
                  amount: inv.amount || received,
                  serverArkAddress,
                };
                l("arkSync returning forward", forward);
              }
            }
          }
        }

        res.send({ synced, received, payments, forward });
      } finally {
        await db.del(lockKey);
      }
    } catch (e) {
      bail(res, e.message);
    }
  },
};
