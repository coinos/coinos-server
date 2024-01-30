import config from "$config";
import store from "$lib/store";
import { emit } from "$lib/sockets";
import { v4 } from "uuid";
import { db, g, s, t } from "$lib/db";
import { l, err, warn } from "$lib/logging";
import { bail, fail, getInvoice, btc, sats, SATS } from "$lib/utils";
import { requirePin } from "$lib/auth";
import {
  completePayment,
  debit,
  credit,
  types,
  getNode,
  build,
  sendLightning,
  sendOnchain,
} from "$lib/payments";
import { mqtt1, mqtt2 } from "$lib/mqtt";
import got from "got";

import lq from "$lib/liquid";
import bc from "$lib/bitcoin";
import ln from "$lib/ln";

export default {
  async info({ body, user }, res) {
    res.send(await ln.getinfo());
  },

  async create({ body, user }, res) {
    let { amount, hash, maxfee, fund, memo, payreq, rate, username } = body;
    let balance = await g(`balance:${user.id}`);

    try {
      if (await g("freeze")) fail("Problem sending payment");

      if (typeof amount !== "undefined") {
        amount = parseInt(amount);
        if (amount < 0 || amount > SATS || isNaN(amount))
          fail("Invalid amount");
      }

      await requirePin({ body, user });

      let p;

      if (username && username.endsWith("@classic")) {
        let { username: source } = user;
        username = username.replace("@classic", "");
        p = await debit({
          hash,
          amount,
          memo: username,
          rate,
          user,
          type: types.classic,
        });

        await got
          .post(`${config.classic}/admin/credit`, {
            json: { username, amount, source },
            headers: { authorization: `Bearer ${config.admin}` },
          })
          .json();
      } else if (payreq) {
        p = await sendLightning({ user, pr: payreq, amount, maxfee, memo });
      }

      if (!p) {
        if (hash) {
          p = await debit({ hash, amount, memo, user });
          await credit(hash, amount, memo, user.id);
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

  async list({ user: { id }, query: { start, end, limit, offset } }, res) {
    if (limit) limit = parseInt(limit);
    offset = parseInt(offset) || 0;

    let payments = (await db.lRange(`${id}:payments`, 0, -1)) || [];
    payments = (
      await Promise.all(
        payments.map(async (id) => {
          let p = await g(`payment:${id}`);
          if (!p) {
            warn("missing payment", id);
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

    let count = payments.length;

    let totals = payments.reduce(
      (a, b) => ({
        ...a,
        [b.currency]: {
          sats:
            (a[b.currency] ? a[b.currency].sats : 0) +
            (b.amount || 0) +
            (b.tip || 0) -
            (b.fee || 0) -
            (b.ourfee || 0),
          fiat: (
            parseFloat(a[b.currency] ? a[b.currency].fiat : 0) +
            (((b.amount || 0) + (b.tip || 0) - (b.fee || 0) - (b.ourfee || 0)) *
              b.rate) /
              SATS
          ).toFixed(2),
        },
      }),
      {},
    );

    if (limit) payments = payments.slice(offset, offset + limit);

    res.send({ payments, count, totals });
  },

  async get({ params: { hash } }, res) {
    let p = await g(`payment:${hash}`);
    if (typeof p === "string") p = await g(`payment:${p}`);
    if (p.type === types.internal) p.with = await g(`user:${p.ref}`);
    res.send(p);
  },

  async parse({ body: { payreq }, user }, res) {
    try {
      let hour = 1000 * 60 * 60;
      let { last } = store.nodes;
      let { nodes } = store;

      if (!last || last > Date.now() - hour) ({ nodes } = await ln.listnodes());
      store.nodes = nodes;

      let twoWeeksAgo = new Date(new Date().setDate(new Date().getDate() - 14));
      let decoded = await ln.decodepay(payreq);
      let { amount_msat, payee } = decoded;
      let node = nodes.find((n) => n.nodeid === payee);
      let alias = node ? node.alias : payee.substr(0, 12);

      let amount = Math.round(amount_msat / 1000);
      let ourfee = Math.round(amount * config.fee);
      let credit = await g(`credit:lightning:${user.id}`);
      let covered = Math.min(credit, ourfee) || 0;
      ourfee -= covered;

      res.send({ alias, amount, ourfee });
    } catch (e) {
      bail(res, e.message);
    }
  },

  async fund({ params: { name } }, res) {
    let amount = await g(`fund:${name}`);
    if (typeof amount === "undefined" || amount === null)
      return bail(res, "fund not found");
    let payments = (await db.lRange(`fund:${name}:payments`, 0, -1)) || [];
    payments = await Promise.all(payments.map((hash) => g(`payment:${hash}`)));

    await Promise.all(
      payments.map(async (p) => (p.user = await g(`user:${p.uid}`))),
    );

    payments = payments.filter((p) => p);
    res.send({ amount, payments });
  },

  async withdraw({ params: { name } }, res) {
    let maxWithdrawable = await g(`fund:${name}`);
    res.send({
      tag: "withdrawRequest",
      callback: `${URL}/lnurlw/${name}`,
      k1: name,
      defaultDescription: `Withdraw from coinos fund ${name}`,
      minWithdrawable: 0,
      maxWithdrawable,
    });
  },

  async take({ body: { id, amount, invoice: iid }, user }, res) {
    try {
      amount = parseInt(amount);
      if (amount < 0) fail("Invalid amount");

      await t(`fund:${id}`, async (balance, db) => {
        if (balance < amount) fail("Insufficient funds");
        await db.multi().decrBy(`fund:${id}`, amount).exec();
      });

      if (!iid) {
        iid = v4();
        let { currency } = user;
        await s(`invoice:${iid}`, {
          currency,
          id: iid,
          hash: iid,
          rate: store.rates[currency],
          uid: user.id,
          received: 0,
        });
      }

      let payment = await credit(iid, amount, id, id, types.fund);
      await db.lPush(`fund:${id}:payments`, payment.id);

      res.send({ payment });
    } catch (e) {
      warn("problem withdrawing from fund", e.message);
      bail(res, e.message);
    }
  },

  async confirm({ body: { txid, wallet, type } }, res) {
    try {
      let node = getNode(type);

      if (wallet === config.bitcoin.wallet || wallet === config.liquid.wallet) {
        let { confirmations, details } = await node.getTransaction(txid);
        for (let { address, amount, asset, category, vout } of details) {
          if (!address) continue;
          if (type === types.liquid && asset !== config.liquid.btc) continue;
          if (category !== "receive") continue;
          let p = await g(`payment:${txid}:${vout}`);
          if (typeof p === "string") p = await g(`payment:${p}`);

          if (!p) {
            await credit(address, sats(amount), "", `${txid}:${vout}`, type);
          } else if (confirmations >= 1) {
            let id = `payment:${txid}:${vout}`;
            let p = await g(id);
            if (typeof p === "string") p = await g(`payment:${p}`);
            if (!p) return db.sAdd("missed", id);
            if (p.confirmed) return;

            let invoice = await getInvoice(address);
            let { id: iid } = invoice;

            p.confirmed = true;
            invoice.received += parseInt(invoice.pending);
            invoice.pending = 0;

            l("confirming", txid);

            let r = await db
              .multi()
              .set(`invoice:${iid}`, JSON.stringify(invoice))
              .set(`payment:${p.id}`, JSON.stringify(p))
              .decrBy(`pending:${p.uid}`, p.amount)
              .incrBy(`balance:${p.uid}`, p.amount)
              .exec();

            emit(p.uid, "payment", p);
            let user = await g(`user:${p.uid}`);
              await completePayment(p, user);
          }
        }
      }
      res.send({});
    } catch (e) {
      console.log(e);
      warn(`problem processing ${txid}`);
      bail(res, e.message);
    }
  },

  async fee({ body, user }, res) {
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
      bail(res, "Failed to prepare transaction " + msg);
    }
  },

  async send({ body, user }, res) {
    try {
      await requirePin({ body, user });
      let { hash: txid } = await sendOnchain({ ...body, user });

      res.send({ txid });
    } catch (e) {
      console.log(e);
      warn("payment failed", e.message);
      res.code(500).send(e.message);
    }
  },

  async freeze({ body: { secret } }, res) {
    try {
      if (secret !== config.adminpass) fail("unauthorized");
      await s("freeze", true);
      res.send("ok");
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async print({ body: { id }, user }, res) {
    try {
      let p = await g(`payment:${id}`);
      if (p.uid !== user.id) fail("unauthorized");
      emit(user.id, "payment", p);

      let { username } = user;

      mqtt1.publish(
        username,
        `pay:${p.amount}:${p.tip}:${p.rate}:${p.created}:${p.id}`,
      );

      mqtt2.publish(
        username,
        `pay:${p.amount}:${p.tip}:${p.rate}:${p.created}:${p.id}`,
      );

      res.send({ ok: true });
    } catch (e) {
      bail(res, e.message);
    }
  },

  async lnaddress({ params: { lnaddress, amount }, body, user }, res) {
    try {
      lnaddress = decodeURIComponent(lnaddress);
      await requirePin({ body, user });

      let maxfee = 5000;
      let [username, domain] = lnaddress.split("@");
      let { minSendable, maxSendable, callback, metadata } = await got(
        `https://${domain}/.well-known/lnurlp/${username}`,
      ).json();

      let memo = metadata["text/plain"] || "";
      if (amount * 1000 < minSendable || amount * 1000 > maxSendable)
        fail("amount out of range");

      let r = await got(`${callback}?amount=${amount * 1000}`).json();
      if (r.reason) fail(r.rason);
      let { pr } = r;
      let p = await sendLightning({ user, pr, amount, maxfee, memo });

      if (!p) {
        p = await debit({ hash: pr, amount, memo, user });
        await credit(pr, amount, memo, user.id);
      }

      res.send(p);
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async gateway({ body: { short_channel_id, webhook } }, res) {
    await s(short_channel_id, webhook);
    res.send({ ok: true });
  },
};
