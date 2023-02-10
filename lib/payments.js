import config from "$config";
import store from "$lib/store";
import { emit } from "$lib/sockets";
import { v4 } from "uuid";
import { notify } from "$lib/notifications";
import { db, g, s, t } from "$lib/db";
import { l, err } from "$lib/logging";
import { fail } from "$lib/utils";
import { callWebhook } from "$lib/webhooks";

export const types = {
  internal: "internal",
  bitcoin: "bitcoin",
  lightning: "lightning",
  pot: "pot",
  classic: "classic",
};

export let debit = async (
  hash,
  amount,
  fee = 0,
  memo,
  user,
  type = types.internal,
  id = v4()
) => {
  let ref;
  let invoice = await g(`invoice:${hash}`);
  if (invoice) ref = invoice.uid;

  let { id: uid, currency, username } = user;

  amount = parseInt(amount);

  if (!amount || amount < 0) fail("Amount must be greater than zero");

  let ourfee = [types.bitcoin, types.lightning].includes(type)
    ? Math.round(amount * config.fee)
    : 0;

  await t(`balance:${uid}`, async (balance, db) => {
    await t(`credit:${type}:${uid}`, async (credit, db) => {
      let covered = Math.min(credit, ourfee) || 0;
      ourfee -= covered;

      l("debiting", user.username, balance, amount, ourfee, amount + ourfee);
      if (balance < amount + ourfee) fail("Insufficient funds");
      await db
        .multi()
        .decrBy(`credit:${type}:${uid}`, covered)
        .decrBy(`balance:${uid}`, amount + ourfee)
        .exec();
    });
  });

  let p = {
    id,
    amount: -amount,
    fee,
    ourfee,
    memo,
    uid,
    confirmed: true,
    rate: store.rates[currency],
    currency,
    type,
    ref,
    created: Date.now(),
  };

  await s(`payment:${id}`, p);
  await db.lPush(`${uid}:payments`, id);

  l("sent", type, user.username, amount);
  emit(user.id, "payment", p);

  return p;
};

export let credit = async (hash, amount, memo, ref, type = types.internal) => {
  amount = parseInt(amount);
  let invoice = await g(`invoice:${hash}`);
  if (!invoice) return;
  if (!memo) ({ memo } = invoice);

  let user = await g(`user:${invoice.uid}`);

  let { id: uid, currency, username } = user;

  let p = {
    hash,
    amount,
    uid,
    rate: store.rates[currency],
    currency,
    memo,
    ref,
    type,
    confirmed: true,
    created: Date.now(),
  };

  let { tip } = invoice;
  if (tip) {
    p.tip = tip;
    p.amount -= tip;
  }

  invoice.received += amount;

  let balance = "balance";
  if (type === types.bitcoin) {
    let [txid, vout] = ref.split(":").slice(-2);
    p.id = `${txid}:${vout}`;
    p.confirmed = false;
    balance = "pending";
  } else {
    p.id = hash;
  }

  let m = await db.multi();

  if ([types.bitcoin, types.lightning].includes(type))
    m.incrBy(`credit:${type}:${uid}`, Math.round(amount * config.fee));

  m.set(`invoice:${hash}`, JSON.stringify(invoice))
    .set(`payment:${p.id}`, JSON.stringify(p))
    .lPush(`${uid}:payments`, p.id)
    .incrBy(`${balance}:${uid}`, amount)
    .exec();

  l("received", type, username, amount);
  emit(uid, "payment", p);
  notify(user, `Received ${amount} sats`);
  callWebhook(invoice, p);

  return p;
};

export let confirm = async (address, txid, vout) => {
  let id = `payment:${txid}:${vout}`;
  let p = await g(id);
  if (!p) return db.sAdd("missed", id);

  p.confirmed = true;

  await db
    .multi()
    .set(id, JSON.stringify(p))
    .decrBy(`pending:${p.uid}`, p.amount)
    .incrBy(`balance:${p.uid}`, p.amount)
    .exec();
};
