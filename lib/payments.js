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
  pot: "pot"
};

export let debit = async (
  user,
  amount,
  memo,
  to,
  type = types.internal,
  id = v4()
) => {
  let { id: uid, currency, username } = user;
  to = to && to.id;

  amount = parseInt(amount);

  if (!amount || amount < 0) fail("Amount must be greater than zero");

  await t(`balance:${uid}`, async balance => {
    await new Promise(r => setTimeout(r, 100));
    if (balance < amount) fail("Insufficient funds");
    return balance - amount;
  });

  let fee = 0;

  let p = {
    id,
    amount: -amount,
    memo,
    uid,
    rate: store.rates[currency],
    currency,
    type,
    to,
    created: Date.now()
  };

  if (!to) delete p.to;

  await s(`payment:${hash}`, p);
  await db.lPush(`${uid}:payments`, hash);

  l("sent internal", user.username, amount);
  emit(user.id, "payment", p);

  return p;
};

export let credit = async (hash, amount, memo, from, type = "internal") => {
  amount = parseInt(amount);
  let invoice = await g(`invoice:${hash}`);
  if (!invoice) return;

  let user = await g(`user:${invoice.uid}`);

  let { id: uid, currency, username } = user;

  let p = {
    hash,
    amount,
    uid,
    rate: store.rates[currency],
    currency,
    memo,
    from,
    type,
    confirmed: true,
    created: Date.now()
  };

  let { tip } = invoice;
  if (tip) {
    p.tip = tip;
    p.amount -= tip;
  }

  invoice.received += amount;

  let balance = "balance";
  if (type === types.bitcoin) {
    let [txid, vout] = from.split(":").slice(-2);
    p.id = `${txid}:${vout}`;
    p.confirmed = false;
    balance = "pending";
  } else {
    p.id = hash;
  } 

  await db
    .multi()
    .set(`invoice:${hash}`, JSON.stringify(invoice))
    .set(`payment:${p.id}`, JSON.stringify(p))
    .lPush(`${uid}:payments`, p.id)
    .incrBy(`${balance}:${uid}`, amount)
    .exec();

  l("received internal", username, amount);
  emit(uid, "payment", p);
  notify(user, `Received ${amount} sats`);
  callWebhook(invoice, p);

  return p;
};

export let confirm = async (address, txid, vout) => {
  let id = `payment:${txid}:${vout}`;
  let p = await g(id);
  p.confirmed = true;
  console.log("P", p);

  await db
    .multi()
    .set(id, JSON.stringify(p))
    .decrBy(`pending:${p.uid}`, p.amount)
    .incrBy(`balance:${p.uid}`, p.amount)
    .exec();
};
