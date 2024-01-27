import config from "$config";
import store from "$lib/store";
import { emit } from "$lib/sockets";
import { v4 } from "uuid";
import { notify } from "$lib/notifications";
import { db, g, s, t } from "$lib/db";
import { l, err, warn } from "$lib/logging";
import { btc, fail, getInvoice, sleep, wait, SATS, sats } from "$lib/utils";
import { callWebhook } from "$lib/webhooks";
import got from "got";
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

  let invoice = await getInvoice(hash);
  let iid;

  if (invoice) {
    ({ id: iid } = invoice);
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
  console.log("crediting");
  amount = parseInt(amount) || 0;

  let inv = await getInvoice(hash);
  if (!inv) {
    await db.sAdd("missing", ref.split(":")[0]);
    return;
  }

  let { tip } = inv;
  tip = parseInt(tip) || 0;

  if (!memo) ({ memo } = inv);
  if (amount < 0 || tip < 0) fail("Invalid amount");
  if (type === types.internal) amount += tip;

  let user = await g(`user:${inv.uid}`);
  let { id: uid, currency, username } = user;

  let rate = store.rates[currency];

  if (!rate) await sleep(1000);
  rate = store.rates[currency];

  let equivalentRate =
    inv.rate * (store.rates[currency] / store.rates[inv.currency]);

  if (Math.abs(inv.rate / store.rates[inv.currency] - 1) < 0.01) {
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

  if ([types.bitcoin, types.liquid].includes(type)) inv.pending += amount;
  else inv.received += amount;

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

  m.set(`invoice:${inv.iid}`, JSON.stringify(inv))
    .set(`payment:${p.id}`, JSON.stringify(p))
    .lPush(`${uid}:payments`, p.id)
    .incrBy(`${balance}:${uid}`, amount)
    .exec();

  emit(uid, "payment", p);
  notify(user, `Received ${amount} sats`);
  callWebhook(inv, p);
  l(username, "received", type, amount);

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

  if (config.mqtt1) {
    mqtt1.publish(
      username,
      `pay:${p.amount}:${p.tip}:${p.rate}:${p.created}:${p.id}`,
    );
  }

  if (config.mqtt2) {
    mqtt2.publish(
      username,
      `pay:${p.amount}:${p.tip}:${p.rate}:${p.created}:${p.id}`,
    );
  }

  autowithdraw(user);
  console.log("done crediting");

  return p;
};

let autowithdraw = async (user) => {
  let { autowithdraw, id, destination, threshold, withdrawal } = user;
  destination = destination.trim();
  if (autowithdraw) {
    let balance = await g(`balance:${id}`);
    if (balance > threshold)
      await pay({ amount: withdrawal, to: destination, user });
  }
};

let pay = async ({ amount, to, user }) => {
  amount = parseInt(amount) || 0;
  let lnurl;
  if (to.includes("@") && to.includes(".")) {
    let [name, domain] = to.split("@");
    lnurl = `https://${domain}/.well-known/lnurlp/${name}`;
  } else if (to.startsWith("lnurl")) {
    lnurl = Buffer.from(
      bech32.fromWords(bech32.decode(text, 20000).words),
    ).toString();
  }

  if (lnurl) {
    let { callback } = await got(lnurl).json();
    let { pr } = await got(`${callback}?amount=${amount}`).json();
    await sendLightning(user, pr, amount);
  }

  await sendOnchain({ amount, address: to, user });
};

let decode = async (hex) => {
  let type, tx;
  try {
    tx = await bc.decodeRawTransaction(hex);
    type = types.bitcoin;
  } catch (e) {
    try {
      tx = await lq.decodeRawTransaction(hex);
      type = types.liquid;
    } catch (e) {
      fail("unrecognized tx");
    }
  }

  console.log("TYPE", type);

  return { tx, type };
};

export let sendOnchain = async (params) => {
  let { hex, rate, user } = params;
  if (!hex) ({ hex } = await build(params));

  let { tx, type } = await decode(hex);
  let node = getNode(type);
  let { txid } = tx;

  console.log("YO");

  if (config[type].walletpass)
    await node.walletPassphrase(config[type].walletpass, 300);

  let { hex: signed } = await node.signRawTransactionWithWallet(
    type === types.liquid ? await node.blindRawTransaction(hex) : hex,
  );

  ({ txid } = await node.decodeRawTransaction(signed));

  let r = await node.testMempoolAccept([signed]);
  if (!r[0].allowed) fail("transaction rejected");

  let total = 0;
  let fee = 0;
  let change = 0;

  if (type === types.liquid) {
    for (let {
      asset,
      scriptPubKey: { address, type },
      value,
    } of tx.vout) {
      if (asset !== config.liquid.btc) fail("only L-BTC supported");
      if (type === "fee") fee = sats(value);
      else {
        total += sats(value);

        if (address) {
          if ((await node.getAddressInfo(address)).ismine) {
            change += sats(value);
          }
        }
      }
    }
  } else {
    let totalIn = 0;
    for await (let { txid, vout } of tx.vin) {
      let hex = await node.getRawTransaction(txid);
      let tx = await node.decodeRawTransaction(hex);
      totalIn += sats(tx.vout[vout].value);
    }

    for (let {
      scriptPubKey: { address },
      value,
    } of tx.vout) {
      total += sats(value);
      if (await g(`invoice:${address}`))
        fail("Cannot send to internal address");

      if ((await node.getAddressInfo(address)).ismine) change += sats(value);
    }

    fee = totalIn - total;
  }

  let amount = total - change;

  console.log("HERE", amount, signed.length);

  await debit({
    hash: txid,
    amount,
    fee,
    rate,
    user,
    type,
  });

  return node.sendRawTransaction(signed);
};

export let sendLightning = async (user, payreq, amount, maxfee, memo) => {
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

  let invoice = await getInvoice(hash);

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

let getAddressType = async (a) => {
  console.log("A", a);
  try {
    await bc.getAddressInfo(a);
    return types.bitcoin;
  } catch (e) {
    try {
      await lq.getAddressInfo(a);
      return types.liquid;
    } catch (e) {
      fail("unrecognized address");
    }
  }
};

export let build = async ({ amount, address, feeRate, user }) => {
  let type = await getAddressType(address);
  console.log("type", type, amount);

  let node = getNode(type);
  amount = parseInt(amount);

  let fees = { halfHourFee: 50 };

  // let fees = await fetch(`${api[type]}/fees/recommended`).then((r) => r.json());

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

export let catchUp = async () => {
  try {
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
        if (await db.zScore("seen", txid)) continue;
        await got.post(`http://localhost:${process.env.PORT || 3119}/confirm`, {
          json: { txid, wallet: config.bitcoin.wallet, type },
        });

        await db.zAdd("seen", { score: Date.now(), value: txid });
        if ((await db.zCard("seen")) > 10000)
          await db.zRemRangeByRank("seen", 0, 0);
      } catch (e) {
        err("problem confirming", e.message);
      }
    }
  } catch (e) {
    err("problem syncing", e.message);
  }

  setTimeout(catchUp, 2000);
};
