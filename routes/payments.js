import config from "$config";
import store from "$lib/store";
import { emit } from "$lib/sockets";
import { v4 } from "uuid";
import { db, g, s, t } from "$lib/db";
import { l, err } from "$lib/logging";
import { fail, btc, sats } from "$lib/utils";
import { requirePin } from "$lib/auth";
import { debit, credit, confirm, types } from "$lib/payments";
import got from "got";

import bc from "$lib/bitcoin";
import ln from "$lib/ln";

export default {
  async create({ body, user }, res) {
    let { amount, hash, maxfee, name, memo, payreq, tip, username } = body;

    amount = parseInt(amount);
    maxfee = parseInt(maxfee);
    tip = parseInt(tip);

    await requirePin({ body, user });

    let p;

    if (username && username.endsWith("@classic")) {
      let { username: source } = user;
      username = username.replace("@classic", "");
      p = await debit(hash, amount, 0, memo, user, types.classic);

      await got
        .post(`${config.classic}/admin/credit`, {
          json: { username, amount, source },
          headers: { authorization: `Bearer ${config.admin}` }
        })
        .json();
    } else if (payreq) {
      let { msatoshi } = await ln.decode(payreq);
      if (msatoshi) amount = Math.round(msatoshi * 1000);

      p = await debit(
        hash,
        amount + maxfee,
        maxfee,
        memo,
        user,
        types.lightning
      );

      let r = await ln.pay(payreq, msatoshi ? undefined : `${amount}sats`);

      p.amount = -amount;
      p.hash = r.payment_hash;
      p.fee = r.msatoshi_sent - r.msatoshi;
      p.ref = r.payment_preimage;

      await s(`payment:${p.id}`, p);
      await db.incrBy(`balance:${p.uid}`, maxfee - p.fee);
    } else if (hash) {
      p = await debit(hash, amount, 0, memo, user);
      await credit(hash, amount, memo, user.id);
    } else {
      let pot = name || v4();
      p = await debit(hash, amount, 0, memo, user, types.pot);
      await db.incrBy(`pot:${pot}`, amount);
      await db.lPush(`pot:${pot}:payments`, p.id);
      l("funded pot", pot);
    }

    res.send(p);
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

    let total = payments.length;

    if (limit) payments = payments.slice(offset, offset + limit);

    res.send({ payments, total });
  },

  async get({ params: { hash } }, res) {
    res.send(await g(`payment:${hash}`));
  },

  async parse({ body: { payreq } }, res) {
    let hour = 1000 * 60 * 60;
    let { last } = store.nodes;
    let { nodes } = store;

    if (!last || last > Date.now() - hour) ({ nodes } = await ln.listnodes());
    store.nodes = nodes;

    let twoWeeksAgo = new Date(new Date().setDate(new Date().getDate() - 14));
    let decoded = await ln.decodepay(payreq);
    let { msatoshi, payee } = decoded;
    let node = nodes.find(n => n.nodeid === payee);
    let alias = node ? node.alias : payee.substr(0, 12);

    res.send({ alias, amount: Math.round(msatoshi / 1000) });
  },

  async pot({ params: { name } }, res) {
    let amount = await g(`pot:${name}`);
    if (!amount) fail("pot not found");
    let payments = (await db.lRange(`pot:${name}:payments`, 0, -1)) || [];
    payments = await Promise.all(payments.map(hash => g(`payment:${hash}`)));

    await Promise.all(
      payments.map(async p => (p.user = await g(`user:${p.uid}`)))
    );

    payments = payments.filter(p => p);
    res.send({ amount, payments });
  },

  async take({ body: { name, amount }, user }, res) {
    amount = parseInt(amount);
    await t(`pot:${name}`, async (balance, db) => {
      if (balance < amount) fail("Insufficient funds");
      await db
        .multi()
        .decrBy(`pot:${name}`, amount)
        .exec();
    });

    let hash = v4();
    await s(`invoice:${hash}`, {
      uid: user.id,
      received: 0
    });

    let payment = await credit(hash, amount, "", name, types.pot);
    await db.lPush(`pot:${name}:payments`, hash);

    res.send({ payment });
  },

  async bitcoin({ body: { txid, wallet } }, res) {
    if (wallet === config.bitcoin.wallet) {
      let { confirmations, details } = await bc.getTransaction(txid);
      for (let { address, amount, vout } of details) {
        if (confirmations > 0) {
          await confirm(address, txid, vout);
        } else {
          await credit(
            address,
            sats(amount),
            "",
            `${txid}:${vout}`,
            types.bitcoin
          );
        }
      }
    }
    res.send({});
  },

  async fee(req, res) {
    let { amount, address, feeRate, subtract } = req.body;
    let subtractFeeFromOutputs = subtract ? [0] : [];
    let replaceable = true;
    let outs = [{ [address]: btc(amount) }];
    let count = await bc.getBlockCount();

    let raw = await bc.createRawTransaction([], outs, 0, replaceable);
    let tx = await bc.fundRawTransaction(raw, {
      feeRate,
      subtractFeeFromOutputs,
      replaceable
    });

    if (config.bitcoin.walletpass)
      await bc.walletPassphrase(config.bitcoin.walletpass, 300);

    let { hex } = await bc.signRawTransactionWithWallet(tx.hex);
    let { vsize } = await bc.decodeRawTransaction(hex);
    feeRate = Math.round((sats(tx.fee) * 1000) / vsize);

    res.send({ feeRate, tx });
  },

  async send(req, res) {
    await requirePin(req);

    let { user } = req;
    let { address, memo, tx } = req.body;
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
  },
};
