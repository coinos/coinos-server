import config from "$config";
import store from "$lib/store";
import { emit } from "$lib/sockets";
import { v4 } from "uuid";
import { notify } from "$lib/notifications";
import { db, g, s, t } from "$lib/db";
import { l, err, warn } from "$lib/logging";
import { fail, wait, SATS } from "$lib/utils";
import { callWebhook } from "$lib/webhooks";
import got from "got";
import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import EventEmitter from "events";
import crc32 from "buffer-crc32";
import { mqtt1, mqtt2 } from "$lib/mqtt";
import ln from "$lib/ln";
import { mail, templates } from "$lib/mail";

export const types = {
  internal: "internal",
  bitcoin: "bitcoin",
  lightning: "lightning",
  fund: "fund",
  classic: "classic",
};

export let debit = async ({
  hash,
  amount,
  fee = 0,
  memo,
  user,
  type = types.internal,
  id = v4(),
  rate,
}) => {
  let ref;
  let { id: uid, currency, username } = user;
  if (!rate) rate = store.rates[currency];

  let iid = await g(`invoice:${hash}`);
  if (iid && iid.hash) iid = iid.hash;
  let invoice = await g(`invoice:${iid}`);

  if (invoice) {
    ref = invoice.uid;

    let equivalentRate =
      invoice.rate * (store.rates[currency] / store.rates[invoice.currency]);

    if (Math.abs(invoice.rate / store.rates[invoice.currency] - 1) < 0.01) {
      rate = equivalentRate;
    } else {
      warn("rate slipped", hash, invoice.rate, equivalentRate);
    }
  }

  let tip = parseInt(invoice?.tip) || null;

  if (!amount || amount < 0) fail("Amount must be greater than zero");

  let ourfee = [types.bitcoin, types.lightning].includes(type)
    ? Math.round(amount * config.fee)
    : 0;

  let r = await db.debit(
    `balance:${uid}`,
    `credit:${type}:${uid}`,
    amount || 0,
    tip || 0,
    fee || 0,
    ourfee || 0
  );

  if (r !== "ok") fail("Problem debiting account");

  let p = {
    id,
    amount: -amount,
    fee,
    hash,
    ourfee,
    memo,
    iid,
    uid,
    confirmed: true,
    rate,
    currency,
    type,
    ref,
    tip,
    created: Date.now(),
  };

  await s(`payment:${id}`, p);
  await db.lPush(`${uid}:payments`, id);

  l(user.username, "sent", type, amount);
  emit(user.id, "payment", p);

  return p;
};

export let credit = async (hash, amount, memo, ref, type = types.internal) => {
  amount = parseInt(amount) || 0;

  let iid = await g(`invoice:${hash}`);
  if (iid && iid.hash) iid = iid.hash;
  let invoice = await g(`invoice:${iid}`);

  if (!invoice) {
    await db.sAdd("missing", hash);
    return;
  }

  let { tip } = invoice;
  tip = parseInt(tip) || 0;

  if (!memo) ({ memo } = invoice);
  if (amount < 0 || tip < 0) fail("Invalid amount");
  if (type === types.internal) amount += tip;

  let user = await g(`user:${invoice.uid}`);

  let { id: uid, currency, username } = user;

  let rate = store.rates[currency];

  let equivalentRate =
    invoice.rate * (store.rates[currency] / store.rates[invoice.currency]);

  if (Math.abs(invoice.rate / store.rates[invoice.currency] - 1) < 0.01) {
    rate = equivalentRate;
  } else {
    // warn("rate slipped", hash, invoice.rate, equivalentRate);
  }

  let id = v4();
  let p = {
    id,
    hash,
    amount: parseInt(amount - tip),
    uid,
    rate,
    currency,
    memo,
    ref,
    tip,
    type,
    confirmed: true,
    created: Date.now(),
  };

  if (type === types.bitcoin) invoice.pending += amount;
  else invoice.received += amount;

  let balance = "balance";
  if (type === types.bitcoin) {
    let [txid, vout] = ref.split(":").slice(-2);
    p.confirmed = false;
    balance = "pending";
    await s(`payment:${txid}:${vout}`, id);
  } else {
    await s(`payment:${hash}`, id);
  }

  let m = await db.multi();

  if ([types.bitcoin, types.lightning].includes(type))
    m.incrBy(`credit:${type}:${uid}`, Math.round(amount * config.fee));

  m.set(`invoice:${iid}`, JSON.stringify(invoice))
    .set(`payment:${p.id}`, JSON.stringify(p))
    .lPush(`${uid}:payments`, p.id)
    .incrBy(`${balance}:${uid}`, amount)
    .exec();

  if (!username.startsWith("lightning"))
    l(username, "received", type, amount, tip);

  emit(uid, "payment", p);
  notify(user, `Received ${amount} sats`);
  callWebhook(invoice, p);

  if (user.verified && user.notify) {
    mail(user, "Payment received", templates.paymentReceived, {
      username,
      sats:
        "⚡️" +
        new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
          p.amount
        ),
      link: `${process.env.URL}/payment/${p.id}`,
    });
  }

  mqtt1.publish(
    username,
    `pay:${p.amount}:${p.tip}:${p.rate}:${p.created}:${p.id}`
  );

  mqtt2.publish(
    username,
    `pay:${p.amount}:${p.tip}:${p.rate}:${p.created}:${p.id}`
  );

  return p;
};

export let confirm = async (address, txid, vout) => {
  let id = `payment:${txid}:${vout}`;
  let p = await g(id);
  if (typeof p === "string") p = await g(`payment:${p}`);
  if (!p) return db.sAdd("missed", id);
  if (p.confirmed) return;

  p.confirmed = true;
  emit(p.uid, "payment", p);

  l("confirming", txid);

  let r = await db
    .multi()
    .set(`payment:${p.id}`, JSON.stringify(p))
    .decrBy(`pending:${p.uid}`, p.amount)
    .incrBy(`balance:${p.uid}`, p.amount)
    .exec();
};

export let payLightning = async (user, payreq, amount, maxfee, memo) => {
  let p;
  let hash = payreq;

  if (typeof amount !== "undefined") {
    amount = parseInt(amount);
    if (amount < 0 || amount > SATS || isNaN(amount)) fail("Invalid amount");
  }

  let total = amount;
  let { amount_msat, payment_hash } = await ln.decode(payreq);
  if (amount_msat) total = Math.round(amount_msat / 1000);

  maxfee = maxfee ? parseInt(maxfee) : Math.round(total * 0.05);
  if (maxfee < 0) fail("Max fee cannot be negative");

  let iid = await g(`invoice:${hash}`);
  if (iid && iid.hash) iid = iid.hash;
  let invoice = await g(`invoice:${iid}`);

  if (invoice) {
    if (invoice.uid === user.id) fail("Cannot send to self");
    hash = payreq;
  } else {
    let r;

    let { pays } = await ln.listpays(payreq);
    if (pays.find((p) => p.status === "complete"))
      fail("Invoice has already been paid");

    if (pays.find((p) => p.status === "pending"))
      fail("Payment is already underway");

    p = await debit({
      hash: payreq,
      amount: total,
      fee: maxfee,
      memo,
      user,
      type: types.lightning,
    });

    let check = async () => {
      try {
        let { pays } = await ln.listpays(payreq);

        let recordExists = !!(await g(`payment:${p.id}`));
        let paymentFailed =
          !pays.length || pays.every((p) => p.status === "failed");

        if (recordExists && paymentFailed) {
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
      l("paying lightning invoice", payreq.substr(-8), total, amount, maxfee);

      r = await ln.pay({
        bolt11: payreq.replace(/\s/g, "").toLowerCase(),
        amount_msat: amount_msat ? undefined : amount * 1000,
        maxfee: maxfee * 1000,
        retry_for: 5,
      });

      if (!(r.status === "complete" && r.payment_preimage))
        fail("Payment did not complete");

      l("payment completed", p.id, r.payment_preimage);

      p.amount = -total;
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

  return p;
};
