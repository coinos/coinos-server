import config from "$config";
import api from "$lib/api";
import { requirePin } from "$lib/auth";
import { db, g, s, t } from "$lib/db";
import { err, l, warn } from "$lib/logging";
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
  types,
} from "$lib/payments";
import { emit } from "$lib/sockets";
import {
  SATS,
  bail,
  fail,
  getInvoice,
  getPayment,
  getUser,
  sats,
} from "$lib/utils";
import rpc from "@coinos/rpc";
import got from "got";
import { v4 } from "uuid";

import ln from "$lib/ln";

export default {
  async info(_, res) {
    res.send(await ln.getinfo());
  },

  async create(req, res) {
    const { body, user } = req;
    let { amount, hash, fee, fund, memo, payreq } = body;
    const balance = await g(`balance:${user.id}`);

    try {
      if (await g("freeze")) fail("Problem sending payment");

      if (typeof amount !== "undefined") {
        amount = parseInt(amount);
        if (amount < 0 || amount > SATS || Number.isNaN(amount))
          fail("Invalid amount");
      }

      await requirePin({ body, user });

      let p;

      if (payreq) {
        const iid = await g(`invoice:${payreq}`);
        if (iid) {
          const invoice = await g(`invoice:${iid}`);
          if (invoice.aid === user.id) fail("Cannot send to self");
          hash = payreq;
          if (!amount) ({ amount } = invoice);
        } else {
          p = await sendLightning({ user, pr: payreq, amount, fee, memo });
        }
      }

      if (!p) {
        if (hash) {
          p = await debit({ hash, amount, memo, user });
          await credit({ hash, amount, memo, ref: user.id });
        } else if (fund) {
          p = await debit({ hash, amount, memo: fund, user, type: types.fund });
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
      query: { aid, start, end, limit, offset },
    } = req;
    if (!aid || aid === "undefined") aid = id;

    limit = parseInt(limit) || 25;
    offset = parseInt(offset) || 0;

    const range = start || end ? -1 : limit - 1;
    let payments = (await db.lRange(`${aid || id}:payments`, 0, range)) || [];

    payments = (
      await Promise.all(
        payments.map(async (pid) => {
          const p = await g(`payment:${pid}`);
          if (!p) {
            warn("user", id, "missing payment", pid);
            await db.lRem(`${aid || id}:payments`, 0, pid);
            return p;
          }
          if (p.created < start || p.created > end) return;
          if (p.type === types.internal) p.with = await g(`user:${p.ref}`);
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
          parseFloat(a[b.currency] ? a[b.currency].fiatTips : 0) +
          ((b.tip || 0) * b.rate) / SATS
        ).toFixed(2),
        sats:
          (a[b.currency] ? a[b.currency].sats : 0) +
          (b.amount || 0) +
          (b.tip || 0) -
          (b.fee || 0) -
          (b.ourfee || 0),
        fiat: (
          parseFloat(a[b.currency] ? a[b.currency].fiat : 0) +
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
      if (p?.type === types.internal) p.with = await g(`user:${p.ref}`);
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
      let ourfee = Math.round(amount * config.fee);
      const credit = await g(`credit:lightning:${user.id}`);
      const covered = Math.min(credit, ourfee) || 0;
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
      params: { name },
    } = req;
    const amount = await g(`fund:${name}`);
    if (typeof amount === "undefined" || amount === null)
      return bail(res, "fund not found");
    let payments = (await db.lRange(`fund:${name}:payments`, 0, -1)) || [];
    payments = await Promise.all(payments.map((hash) => g(`payment:${hash}`)));

    await Promise.all(
      payments.map(async (p: any) => (p.user = await g(`user:${p.uid}`))),
    );

    payments = payments.filter((p) => p);
    res.send({ amount, payments });
  },

  async withdraw(req, res) {
    const {
      params: { name },
    } = req;
    const maxWithdrawable = await g(`fund:${name}`);
    res.send({
      tag: "withdrawRequest",
      callback: `${URL}/lnurlw/${name}`,
      k1: name,
      defaultDescription: `Withdraw from coinos fund ${name}`,
      minWithdrawable: 0,
      maxWithdrawable,
    });
  },

  async take(req, res) {
    let {
      body: { id, amount, invoice: iid },
      user,
    } = req;
    try {
      amount = parseInt(amount);
      if (amount < 0) fail("Invalid amount");

      await t(`fund:${id}`, async (balance, db) => {
        if (balance < amount) fail("Insufficient funds");
        await db.multi().decrBy(`fund:${id}`, amount).exec();
      });

      if (!iid) {
        iid = v4();
        const rates = await g("rates");
        const { currency } = user;
        await s(`invoice:${iid}`, {
          currency,
          id: iid,
          hash: iid,
          rate: rates[currency],
          uid: user.id,
          received: 0,
        });
      }

      const payment = await credit({
        hash: iid,
        amount,
        memo: id,
        ref: id,
        type: types.fund,
      });
      await db.lPush(`fund:${id}:payments`, payment.id);

      res.send({ payment });
    } catch (e) {
      warn("problem withdrawing from fund", e.message);
      bail(res, e.message);
    }
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

      for (const { address, amount, asset, category, vout } of details) {
        if (!address) continue;
        if (type === types.liquid && asset !== config.liquid.btc) continue;

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

        const p = await getPayment(`${txid}:${vout}`);

        if (!p) {
          const invoice = await getInvoice(address);
          if (!hot && aid !== invoice?.aid) continue;
          await credit({
            hash: address,
            amount: sats(amount),
            ref: `${txid}:${vout}`,
            type,
            aid,
          });
        } else if (confirmations >= 1) {
          const id = `payment:${txid}:${vout}`;
          const p = await getPayment(`${txid}:${vout}`);
          if (!p) return db.sAdd("missed", id);
          if (p.confirmed) return;

          const invoice = await getInvoice(address);
          const { id: iid } = invoice;

          p.confirmed = true;
          invoice.received += parseInt(invoice.pending);
          invoice.pending = 0;

          l("confirming", id, p.id, p.amount);

          await db
            .multi()
            .set(`invoice:${iid}`, JSON.stringify(invoice))
            .set(`payment:${p.id}`, JSON.stringify(p))
            .decrBy(`pending:${p.aid || p.uid}`, p.amount)
            .incrBy(`balance:${p.aid || p.uid}`, p.amount)
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
      console.log(e);
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
      const p = await g(`payment:${id}`);
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
      params: { lnaddress, amount, fee = 5000 },
      body,
      user,
    } = req;
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
      const p = await g(`payment:${id}`);
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
};
