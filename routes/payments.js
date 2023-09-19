import config from "$config";
import store from "$lib/store";
import { emit } from "$lib/sockets";
import { v4 } from "uuid";
import { db, g, s, t } from "$lib/db";
import { l, err, warn } from "$lib/logging";
import { bail, fail, btc, sats, SATS } from "$lib/utils";
import { requirePin } from "$lib/auth";
import { debit, credit, confirm, types } from "$lib/payments";
import got from "got";

import bc from "$lib/bitcoin";
import ln from "$lib/ln";

let seen = [];
let catchUp = async () => {
  let txns = await bc.listTransactions("*", 50);
  txns = txns.filter(tx => tx.category === "receive" && tx.confirmations > 0);
  for (let { txid } of txns) {
    try {
      if (seen.includes(txid)) continue;
      await got.post(`http://localhost:${process.env.PORT || 3119}/bitcoin`, {
        json: { txid, wallet: config.bitcoin.wallet }
      });

      seen.push(txid);
    } catch (e) {
      console.log(e.message);
    }
  }
  setTimeout(catchUp, 2000);
};

catchUp();

export default {
  async create({ body, user }, res) {
    let { amount, hash, maxfee, name, memo, payreq, username } = body;

    try {
      amount = parseInt(amount);
      maxfee = maxfee ? parseInt(maxfee) : 0;
      if (maxfee < 0) fail("Max fee cannot be negative");

      await requirePin({ body, user });

      let p;

      if (username && username.endsWith("@classic")) {
        let { username: source } = user;
        username = username.replace("@classic", "");
        p = await debit(hash, amount, 0, username, user, types.classic);

        await got
          .post(`${config.classic}/admin/credit`, {
            json: { username, amount, source },
            headers: { authorization: `Bearer ${config.admin}` }
          })
          .json();
      } else if (payreq) {
        let total = amount;
        let { amount_msat, payment_hash } = await ln.decode(payreq);
        if (amount_msat) total = Math.round(amount_msat / 1000);
        let invoice = await g(`invoice:${payreq}`);

        if (invoice) {
          if (invoice.uid === user.id) fail("Cannot send to self");
          hash = payreq;
        } else {
          let r;

          let { pays } = await ln.listpays(payreq);
          if (pays.find(p => p.status === "complete"))
            fail("Invoice has already been paid");

          if (pays.find(p => p.status === "pending"))
            fail("Payment is already underway");

          p = await debit(payreq, total, maxfee, memo, user, types.lightning);

          let check = async () => {
            try {
              let { pays } = await ln.listpays(payreq);

              let recordExists = !!(await g(`payment:${p.id}`));
              let paymentFailed =
                !pays.length || pays.every(p => p.status === "failed");

              l("checking", payreq, recordExists, paymentFailed);

              if (
                recordExists &&
                paymentFailed
              ) {
                await db.del(`payment:${p.id}`);

                let credit = Math.round(total * config.fee) - p.ourfee;
                warn("crediting balance", total + maxfee + p.ourfee);
                await db.incrBy(`balance:${p.uid}`, total + maxfee + p.ourfee);

                warn("crediting credits", credit);
                await db.incrBy(`credit:${types.lightning}:${p.uid}`, credit);

                warn("reversing payment", p.id);
                await db.lRem(`${p.uid}:payments`, 1, p.id);

                clearInterval(interval);
              }
            } catch (e) {
              console.log(e);
              err("Failed to reverse payment", r);
            }
          };

          let interval = setInterval(check, 5000);

          try {
            l("paying lightning invoice", payreq);

            r = await ln.pay({
              bolt11: payreq.replace(/\s/g, "").toLowerCase(),
              amount_msat: amount_msat ? undefined : amount * 1000,
              maxfee: maxfee * 1000,
              retry_for: 5
            });

            if (!(r.status === "complete" && r.payment_preimage))
              fail("Payment did not complete");

            l("payment completed", p.id, r.payment_preimage);

            p.amount = -amount;
            p.tip = total - amount;
            p.hash = r.payment_hash;
            p.fee = Math.round((r.amount_sent_msat - r.amount_msat) / 1000);
            p.ref = r.payment_preimage;

            await s(`payment:${p.id}`, p);

            l("refunding fee", maxfee, p.fee, maxfee - p.fee, p.ref);
            await db.incrBy(`balance:${p.uid}`, maxfee - p.fee);
          } catch (e) {
            warn("something went wrong", e.message);
            await check();
            throw e;
          }

          clearInterval(interval);
        }
      }

      if (!p) {
        if (hash) {
          p = await debit(hash, amount, 0, memo, user);
          await credit(hash, amount, memo, user.id);
        } else {
          let pot = name || v4();
          memo = pot;
          p = await debit(hash, amount, 0, memo, user, types.pot);
          await db.incrBy(`pot:${pot}`, amount);
          await db.lPush(`pot:${pot}:payments`, p.id);
          l("funded pot", pot);
        }
      }

      res.send(p);
    } catch (e) {
      warn(e.message);
      warn("failed to create payment", username, amount, hash, payreq);
      bail(res, e.message);
    }
  },

  async list({ user: { id }, query: { start, end, limit, offset } }, res) {
    if (limit) limit = parseInt(limit);
    offset = parseInt(offset) || 0;

    let payments = (await db.lRange(`${id}:payments`, 0, -1)) || [];
    payments = (
      await Promise.all(
        payments.map(async id => {
          let p = await g(`payment:${id}`);
          if (p.created < start || p.created > end) return;
          if (p.type === types.internal) p.with = await g(`user:${p.ref}`);
          return p;
        })
      )
    )
      .filter(p => p)
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
          ).toFixed(2)
        }
      }),
      {}
    );

    if (limit) payments = payments.slice(offset, offset + limit);

    res.send({ payments, count, totals });
  },

  async get({ params: { hash } }, res) {
    let p = await g(`payment:${hash}`);
    if (p.type === types.internal) p.with = await g(`user:${p.ref}`);
    res.send(p);
  },

  async parse({ body: { payreq } }, res) {
    try {
      let hour = 1000 * 60 * 60;
      let { last } = store.nodes;
      let { nodes } = store;

      if (!last || last > Date.now() - hour) ({ nodes } = await ln.listnodes());
      store.nodes = nodes;

      let twoWeeksAgo = new Date(new Date().setDate(new Date().getDate() - 14));
      let decoded = await ln.decodepay(payreq);
      let { amount_msat, payee } = decoded;
      let node = nodes.find(n => n.nodeid === payee);
      let alias = node ? node.alias : payee.substr(0, 12);

      res.send({ alias, amount: Math.round(amount_msat / 1000) });
    } catch (e) {
      bail(res, e.message);
    }
  },

  async pot({ params: { name } }, res) {
    let amount = await g(`pot:${name}`);
    if (typeof amount === "undefined" || amount === null)
      return bail(res, "pot not found");
    let payments = (await db.lRange(`pot:${name}:payments`, 0, -1)) || [];
    payments = await Promise.all(payments.map(hash => g(`payment:${hash}`)));

    await Promise.all(
      payments.map(async p => (p.user = await g(`user:${p.uid}`)))
    );

    payments = payments.filter(p => p);
    res.send({ amount, payments });
  },

  async withdraw({ params: { name } }, res) {
    let maxWithdrawable = await g(`pot:${name}`);
    res.send({
      tag: "withdrawRequest",
      callback: `${URL}/lnurlw/${name}`,
      k1: name,
      defaultDescription: `Withdraw from coinos pot ${name}`,
      minWithdrawable: 0,
      maxWithdrawable
    });
  },

  async take({ body: { name, amount, hash }, user }, res) {
    try {
      amount = parseInt(amount);
      if (amount < 0) fail("Invalid amount");

      await t(`pot:${name}`, async (balance, db) => {
        if (balance < amount) fail("Insufficient funds");
        await db
          .multi()
          .decrBy(`pot:${name}`, amount)
          .exec();
      });

      if (!hash) {
        hash = v4();
        let { currency } = user;
        await s(`invoice:${hash}`, {
          currency,
          rate: store.rates[currency],
          uid: user.id,
          received: 0
        });
      }

      let payment = await credit(hash, amount, name, name, types.pot);
      await db.lPush(`pot:${name}:payments`, hash);

      res.send({ payment });
    } catch (e) {
      bail(res, e.message);
    }
  },

  async bitcoin({ body: { txid, wallet } }, res) {
    try {
      if (wallet === config.bitcoin.wallet) {
        let { confirmations, details } = await bc.getTransaction(txid);
        for (let { address, amount, category, vout } of details) {
          if (category !== "receive") continue;
          let p = await g(`payment:${txid}:${vout}`);
          if (!p || confirmations < 1) {
            await credit(
              address,
              sats(amount),
              "",
              `${txid}:${vout}`,
              types.bitcoin
            );
          } else {
            await confirm(address, txid, vout);
          }
        }
      }
      res.send({});
    } catch (e) {
      warn(`problem processing ${txid}`);
      bail(res, e.message);
    }
  },

  async fee({ body: { amount, address, feeRate, subtract }, user }, res) {
    try {
      let subtractFeeFromOutputs = subtract ? [0] : [];
      let replaceable = true;

      let ourfee = Math.round(amount * config.fee);
      let credit = await g(`credit:bitcoin:${user.id}`);
      let covered = Math.min(credit, ourfee) || 0;
      ourfee -= covered;

      if (subtract) amount -= ourfee;

      let { feerate: min } = await bc.estimateSmartFee(40);
      let { feerate: max } = await bc.estimateSmartFee(1);

      if (feeRate) feeRate = btc(feeRate);
      else feeRate = max;

      let outs = [{ [address]: btc(amount) }];
      let raw = await bc.createRawTransaction([], outs, 0, replaceable);

      let tx = await bc.fundRawTransaction(raw, {
        feeRate,
        subtractFeeFromOutputs,
        replaceable
      });

      let fee = sats(tx.fee);

      min = sats(min);
      max = Math.round(sats(max) * 1.2);
      feeRate = sats(feeRate);

      res.send({ feeRate, min, max, fee, tx });
    } catch (e) {
      warn("problem estimating fee", e.message);
      bail(res, "problem estimating fee");
    }
  },

  async send(req, res) {
    try {
      await requirePin(req);

      let { user } = req;
      let { address, memo, tx, subtract } = req.body;
      let { hex, fee } = tx;

      if (config.bitcoin.walletpass)
        await bc.walletPassphrase(config.bitcoin.walletpass, 300);

      ({ hex } = await bc.signRawTransactionWithWallet(hex));

      let r = await bc.testMempoolAccept([hex]);
      if (!r[0].allowed) fail("transaction rejected");

      fee = sats(fee);
      if (fee < 0) fail("fee cannot be negative");

      tx = await bc.decodeRawTransaction(hex);
      let { txid } = tx;

      let total = 0;
      let change = 0;

      for (let {
        scriptPubKey: { address },
        value
      } of tx.vout) {
        total += sats(value);
        if (
          (await bc.getAddressInfo(address)).ismine &&
          !(await g(`invoice:${address}`))
        )
          change += sats(value);
      }

      total = total - change + fee;
      let amount = total - fee;

      if (change && !amount) fail("Cannot send to unregistered coinos address");

      await debit(txid, amount, fee, null, user, types.bitcoin, txid);
      await bc.sendRawTransaction(hex);

      res.send({ txid });
    } catch (e) {
      warn("payment failed", e.message);
      res.code(500).send(e.message);
    }
  },

  async buy({ body: { amount, number, year, month, cvc }, user }, res) {
    if (!user.eligible) fail("not eligible");

    let stripe = "https://api.stripe.com/v1";
    let { stripe: username } = config;

    let form = {
      "card[number]": number,
      "card[exp_month]": month,
      "card[exp_year]": year,
      "card[cvc]": cvc
    };

    let { id: source } = await got
      .post(`${stripe}/tokens`, {
        form,
        username
      })
      .json();

    let currency = "CAD";
    form = {
      amount,
      currency,
      source,
      description: "starter coupon"
    };

    let r = await got
      .post(`${stripe}/charges`, {
        form,
        username
      })
      .json();

    let { status } = r;
    if (status === "succeeded") {
      let hash = r.id;
      let memo = "stripe";
      await s(`invoice:${hash}`, {
        uid: user.id,
        received: 0
      });
      amount = sats(amount / store.rates[currency]);
      let uid = await g("user:coinos");
      let coinos = await g(`user:${uid}`);
      let p = await debit(hash, amount, 0, memo, coinos);
      await credit(hash, amount, memo, coinos.id);
    } else fail("Card payment failed");

    res.send({ status });
  },

  async proxy({ body: { method, params } }, res) {
    try {
      let whitelist = [
        "getblock",
        "getblockhash",
        "estimatesmartfee",
        "echo",
        "getblockchaininfo",
        "getnetworkinfo"
      ];

      if (!whitelist.includes(method)) fail("unsupported method");

      if (method === "estimatesmartfee" || method === "getblockhash")
        params[0] = parseInt(params[0]);

      if (method === "getblock") params[1] = parseInt(params[1]);

      let result = await bc[method](...params);

      if (result.feerate) result.feerate = result.feerate.toFixed(8);

      res.send(result);
    } catch (e) {
      bail(res, e.message);
    }
  },

  async fix({ body: { uid, username }, user }, res) {
    try {
      if (!user.admin) fail("unauthorized");
      for await (let k of db.scanIterator({ MATCH: "balance:*" })) {
        let bal = await g(k);
        if (bal < 0) s(k, 0);
      }

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
      res.send({ ok: true });
    } catch (e) {
      bail(res, e.message);
    }
  }
};
