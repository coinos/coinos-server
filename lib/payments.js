import config from "$config";
import store from "$lib/store";
import { emit } from "$lib/sockets";
import { v4 } from "uuid";
import { notify } from "$lib/notifications";
import { db, g, s, t } from "$lib/db";
import { l, err, warn } from "$lib/logging";
import { btc, fail, sleep, wait, SATS, sats } from "$lib/utils";
import { callWebhook } from "$lib/webhooks";
import got from "got";
import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import EventEmitter from "events";
import crc32 from "buffer-crc32";
import { mqtt1, mqtt2 } from "$lib/mqtt";
import { mail, templates } from "$lib/mail";

import lq from "$lib/liquid";
import bc from "$lib/bitcoin";
import ln from "$lib/ln";

let api = {
  bitcoin: "https://mempool.space/api/v1",
  liquid: "https://liquid.network/api/v1",
};

export let types = {
  internal: "internal",
  bitcoin: "bitcoin",
  lightning: "lightning",
  fund: "fund",
  classic: "classic",
  liquid: "liquid",
};

export let debit = async ({
  hash,
  amount,
  fee = 0,
  memo,
  user,
  type = types.internal,
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

  let ourfee = [types.bitcoin, types.liquid, types.lightning].includes(type)
    ? Math.round(amount * config.fee)
    : 0;

  let r = await db.debit(
    `balance:${uid}`,
    `credit:${type}:${uid}`,
    amount || 0,
    tip || 0,
    fee || 0,
    ourfee || 0,
  );

  if (!r || r.err) fail("Problem debiting account");

  let id = v4();
  let p = {
    id,
    amount: -amount,
    fee,
    hash,
    ourfee: r.ourfee,
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

  if (!rate) await sleep(1000);
  rate = store.rates[currency];

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

  if ([types.bitcoin, types.liquid].includes(type)) invoice.pending += amount;
  else invoice.received += amount;

  let balance = "balance";
  if ([types.bitcoin, types.liquid].includes(type)) {
    let [txid, vout] = ref.split(":").slice(-2);
    p.confirmed = false;
    balance = "pending";
    await s(`payment:${txid}:${vout}`, id);
  } else {
    await s(`payment:${hash}`, id);
  }

  let m = await db.multi();

  if ([types.bitcoin, types.liquid, types.lightning].includes(type))
    m.incrBy(`credit:${type}:${uid}`, Math.round(amount * config.fee));

  m.set(`invoice:${iid}`, JSON.stringify(invoice))
    .set(`payment:${p.id}`, JSON.stringify(p))
    .lPush(`${uid}:payments`, p.id)
    .incrBy(`${balance}:${uid}`, amount)
    .exec();

  emit(uid, "payment", p);
  notify(user, `Received ${amount} sats`);
  callWebhook(invoice, p);

  if (user.verified && user.notify) {
    mail(user, "Payment received", templates.paymentReceived, {
      username,
      sats:
        "⚡️" +
        new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
          p.amount,
        ),
      link: `${process.env.URL}/payment/${p.id}`,
    });
  }

  mqtt1.publish(
    username,
    `pay:${p.amount}:${p.tip}:${p.rate}:${p.created}:${p.id}`,
  );

  mqtt2.publish(
    username,
    `pay:${p.amount}:${p.tip}:${p.rate}:${p.created}:${p.id}`,
  );

  return p;
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

          let ourfee = p.ourfee || 0;
          let credit = Math.round(total * config.fee) - ourfee;
          warn("crediting balance", total + maxfee + ourfee);
          await db.incrBy(`balance:${p.uid}`, total + maxfee + ourfee);

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

export let getNode = (type) => {
  if (type === types.bitcoin) return bc;
  else if (type === types.liquid) return lq;
  else fail("unrecognized transaction type");
};

export let build = async ({ amount, address, feeRate }, user) => {
  let type;

  try {
    await bc.getAddressInfo(address);
    type = types.bitcoin;
  } catch (e) {
    try {
      await lq.getAddressInfo(address);
      type = types.liquid;
    } catch (e) {
      fail("unrecognized address");
    }
  }

  let node = getNode(type);
  amount = parseInt(amount);

  let fees = await fetch(`${api[type]}/fees/recommended`).then((r) => r.json());

  if (!feeRate) {
    feeRate = fees.halfHourFee;
  }

  let replaceable = true;
  let ourfee = Math.round(amount * config.fee);
  let credit = await g(`credit:${type}:${user.id}`);
  let covered = Math.min(credit, ourfee) || 0;
  ourfee -= covered;

  let outs = [{ [address]: btc(amount) }];

  if (type === types.liquid)
    outs = outs.map((o) => ({ ...o, asset: config.liquid.btc }));

  let raw = await node.createRawTransaction([], outs, 0, replaceable);

  let tx = await node.fundRawTransaction(raw, {
    fee_rate: feeRate,
    replaceable,
    subtractFeeFromOutputs: [],
  });

  let fee = sats(tx.fee);
  let dust = 547;

  let balance = await g(`balance:${user.id}`);

  if (amount + fee + ourfee > balance) {
    if (amount <= fee + ourfee + dust)
      fail(
        `insufficient funds ⚡️${balance} of ⚡️${amount + fee + ourfee + dust}`,
      );

    outs = [{ [address]: btc(amount - ourfee) }];
    raw = await node.createRawTransaction([], outs, 0, replaceable);

    tx = await node.fundRawTransaction(raw, {
      fee_rate: feeRate,
      replaceable,
      subtractFeeFromOutputs: [0],
    });

    fee = sats(tx.fee);
  }

  return { feeRate, ourfee, fee, fees, hex: tx.hex };
};

let seen;
export let catchUp = async () => {
  try {
    if (!seen) seen = await db.sMembers("missing");
    let txns = [];
    for (let [type, n] of Object.entries({ bitcoin: bc, liquid: lq })) {
      txns.push(
        ...(await n.listTransactions("*", 200)).filter((tx) => {
          tx.type = type;
          return tx.category === "receive" && tx.confirmations > 0;
        }),
      );
    }

    for (let { txid, type } of txns) {
      try {
        if (seen.includes(txid)) continue;
        await got.post(`http://localhost:${process.env.PORT || 3119}/confirm`, {
          json: { txid, wallet: config.bitcoin.wallet, type },
        });

        seen.push(txid);
      } catch (e) {
        err("problem confirming", e.message);
      }
    }
  } catch (e) {
    err("problem syncing", e.message);
  }

  setTimeout(catchUp, 2000);
};
