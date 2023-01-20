import config from "$config";
import store from "$lib/store";
import { emit } from "$lib/sockets";
import { v4 } from "uuid";
import { db, g, s, t } from "$lib/db";
import { l, err } from "$lib/logging";
import { fail, sats } from "$lib/utils";
import { requirePin } from "$lib/auth";
import { debit, credit, confirm, types } from "$lib/payments";

import bc from "$lib/bitcoin";
import ln from "$lib/ln";

const { HOSTNAME: hostname } = process.env;

export default {
  async create({ body, user }, res) {
    let { amount, hash, name, memo, tip } = body;
    await requirePin({ body, user });

    let invoice, recipient;

    let p = await debit(user, amount, memo, recipient);

    if (hash) {
      await credit(hash, amount, memo, user.id);
    } else {
      let pot = name || v4();
      await db.incrBy(`pot:${pot}`, amount);
      await db.lPush(`pot:${pot}:payments`, p.hash);
      l("funded pot", pot);
    }

    res.send(p);
  },

  async list({ user: { id }, query: { start, end, limit, offset } }, res) {
    if (limit) limit = parseInt(limit);
    if (offset) offset = parseInt(offset);

    // if (start || end) where.createdAt = {};
    // if (start) where.createdAt[Op.gte] = new Date(parseInt(start));
    // if (end) where.createdAt[Op.lte] = new Date(parseInt(end));

    let payments = (await db.lRange(`${id}:payments`, 0, -1)) || [];
    payments = await Promise.all(payments.map(hash => g(`payment:${hash}`)));
    payments = payments.filter(p => p);
    res.send({ payments, total: payments.length });
  },

  async get({ params: { hash } }, res) {
    res.send(await g(`payment:${hash}`));
  },

  async query({ body: { payreq } }, res) {
    let hour = 1000 * 60 * 60;
    let { last } = store.nodes;
    let { nodes } = store;

    if (!last || last > Date.now() - hour) ({ nodes } = await ln.listnodes());
    store.nodes = nodes;

    let twoWeeksAgo = new Date(new Date().setDate(new Date().getDate() - 14));
    let { msatoshi, payee } = await ln.decodepay(payreq);
    let node = nodes.find(n => n.nodeid === payee);
    let alias = node ? node.alias : payee.substr(0, 12);

    res.send({ alias, amount: Math.round(msatoshi / 1000) });
  },

  async pot({ params: { name } }, res) {
    let amount = await g(`pot:${name}`);
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
    await t(`pot:${name}`, async balance => {
      await new Promise(r => setTimeout(r, 100));
      if (balance < amount) fail("Insufficient funds");
      return balance - amount;
    });

    let hash = v4();
    await s(`invoice:${hash}`, {
      uid: user.id,
      received: 0
    });

    let payment = await credit(hash, amount, "", name, types.pot);
    await db.lPush(`${name}:payments`, hash);

    res.send({ payment });
  },

  async bitcoin({ body: { txid, wallet } }, res) {
    if (wallet === config.bitcoin.wallet) {
      let { confirmations, details } = await bc.getTransaction(txid);
      for (let { address, amount, vout } of details) {
        if (confirmations > 0) {
          await confirm(address, txid, vout);
        } else {
          await credit(address, sats(amount), "", `${txid}:${vout}`, types.bitcoin);
        }
      }
    }
    res.send({});
  }
};
