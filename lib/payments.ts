import config from "$config";
import { generate } from "$lib/invoices";
import { emit } from "$lib/sockets";
import { v4 } from "uuid";
import { notify } from "$lib/notifications";
import { db, g, s } from "$lib/db";
import { l, err, warn } from "$lib/logging";
import {
  f,
  btc,
  fail,
  fiat,
  getInvoice,
  getPayment,
  getUser,
  sleep,
  SATS,
  sats,
  formatReceipt,
  t,
} from "$lib/utils";
import { callWebhook } from "$lib/webhooks";
import got from "got";
import { mqtt1, mqtt2 } from "$lib/mqtt";
import { mail, templates } from "$lib/mail";
import api from "$lib/api";
import { bech32 } from "bech32";
import rpc from "@coinos/rpc";

import ln from "$lib/ln";

let bc = rpc(config.bitcoin);
let lq = rpc(config.liquid);

let { URL } = process.env;
let dust = 547;

export let types = {
  internal: "internal",
  bitcoin: "bitcoin",
  lightning: "lightning",
  fund: "fund",
  liquid: "liquid",
  ecash: "ecash",
  reconcile: "reconcile",
};

export let debit = async ({
  aid = undefined,
  hash,
  amount,
  fee = 0,
  memo = undefined,
  user,
  type = types.internal,
  rate = undefined,
}) => {
  amount = parseInt(amount);
  if (type !== types.internal && (await g("freeze")))
    fail("Problem sending payment");
  // if (!user.unlimited && amount > 1000000)
  //   fail(`⚡️${amount} exceeds max withdrawal of ⚡️1,000,000`);
  let ref;
  let { id: uid, currency } = user;

  let rates = await g("rates");
  if (!rate) rate = rates[currency];

  let invoice = await getInvoice(hash);
  let iid;

  if (invoice) {
    if (invoice.received >= amount) fail("Invoice already paid");
    ({ id: iid } = invoice);

    ref = invoice.uid;

    let equivalentRate =
      invoice.rate * (rates[currency] / rates[invoice.currency]);

    if (Math.abs(invoice.rate / rates[invoice.currency] - 1) < 0.01) {
      rate = equivalentRate;
    } else {
      warn("rate slipped", hash, invoice.rate, equivalentRate);
    }
  }

  let tip = parseInt(invoice?.tip) || null;
  if (tip < 0) fail("Invalid tip");

  if (!amount || amount < 0) fail("Amount must be greater than zero");

  let ourfee: any = [types.bitcoin, types.liquid, types.lightning].includes(
    type,
  )
    ? Math.round((amount + fee + tip) * config.fee)
    : 0;

  if (aid) ourfee = 0;

  ourfee = await db.debit(
    `balance:${aid || uid}`,
    `credit:${type}:${aid ? 0 : uid}`,
    amount || 0,
    tip || 0,
    fee || 0,
    ourfee || 0,
  );

  if (ourfee.err) fail(ourfee.err);

  let id = v4();
  let p = {
    id,
    aid,
    amount: -amount,
    fee,
    hash,
    hex: undefined,
    ourfee,
    memo,
    iid,
    uid,
    confirmed: ![types.bitcoin, types.liquid].includes(type),
    rate,
    currency,
    type,
    ref,
    tip,
    created: Date.now(),
  };

  await s(`payment:${hash}`, id);
  await s(`payment:${id}`, p);
  await db.lPush(`${aid || uid}:payments`, id);

  l(user.username, "sent", type, amount);
  //emit(user.id, "payment", p);

  return p;
};

export let credit = async ({
  hash,
  amount,
  memo = "",
  ref = "",
  type = types.internal,
  aid = undefined,
}) => {
  amount = parseInt(amount) || 0;

  let inv = await getInvoice(hash);
  if (!inv) {
    await db.sAdd("missing", ref.split(":")[0]);
    return;
  }

  let { path, tip } = inv;
  tip = parseInt(tip) || 0;

  if (!memo) ({ memo } = inv);
  if (memo && memo.length > 5000) fail("memo too long");
  if (amount < 0 || tip < 0) fail("Invalid amount");
  if (type === types.internal) amount += tip;

  let user = await getUser(inv.uid);
  let { id: uid, currency, username } = user;

  let rates = await g("rates");
  let rate = rates[currency];

  if (!rate) await sleep(1000);
  rate = rates[currency];

  let equivalentRate = inv.rate * (rates[currency] / rates[inv.currency]);

  if (Math.abs(inv.rate / rates[inv.currency] - 1) < 0.01) {
    rate = equivalentRate;
  } else {
    // warn("rate slipped", hash, invoice.rate, equivalentRate);
  }

  let id = v4();
  let p = {
    aid,
    id,
    iid: inv.id,
    hash,
    amount: amount - tip,
    path,
    uid,
    rate,
    currency,
    memo,
    ref,
    tip,
    type,
    confirmed: true,
    created: Date.now(),
    items: undefined,
  };

  if ([types.bitcoin, types.liquid].includes(type)) inv.pending += amount;
  else {
    inv.received += amount;
    inv.preimage = ref;
  }

  let balanceKey = "balance";
  if ([types.bitcoin, types.liquid].includes(type)) {
    let [txid, vout] = ref.split(":").slice(-2);
    p.confirmed = false;
    balanceKey = "pending";
    await s(`payment:${txid}:${vout}`, id);
  } else {
    await s(`payment:${hash}`, id);
  }

  let m = await db.multi();

  if ([types.bitcoin, types.liquid, types.lightning].includes(type))
    m.incrBy(`credit:${type}:${uid}`, Math.round(amount * config.fee));

  m.set(`invoice:${inv.id}`, JSON.stringify(inv))
    .set(`payment:${p.id}`, JSON.stringify(p))
    .lPush(`${aid || uid}:payments`, p.id)
    .incrBy(`${balanceKey}:${aid || uid}`, amount)
    .exec();

  emit(uid, "payment", p);
  notify(user, `Received ${amount} sats`);
  callWebhook(inv, p);
  l(username, "received", type, amount);

  let items;
  if (inv.items && inv.items.length) {
    formatReceipt(inv.items, inv.currency);
    p.items = inv.items;
  }

  if (config.mqtt1) {
    if (!mqtt1.connected) await mqtt1.reconnect();
    mqtt1.publish(
      username,
      `pay:${p.amount}:${p.tip}:${p.rate}:${p.created}:${p.id}:${p.memo}:${items}`,
    );
  }

  if (config.mqtt2) {
    if (!mqtt2.connected) await mqtt2.reconnect();
    mqtt2.publish(
      username,
      `pay:${p.amount}:${p.tip}:${p.rate}:${p.created}:${p.id}:${p.memo}:${items}`,
    );
  }

  try {
    await completePayment(p, user);
  } catch (e) {
    console.log(e);
  }

  return p;
};

let fmt = (sats) =>
  "⚡️" +
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(sats);

export let completePayment = async (p, user) => {
  let { id, autowithdraw, threshold, reserve, destination, username } = user;
  let link = (id) => `${URL}/payment/${id}`;
  if (p.confirmed) {
    let withdrawal;
    if (autowithdraw) {
      try {
        let to = destination.trim();
        let balance = await g(`balance:${id}`);
        let amount = balance - reserve;
        if (balance > threshold) {
          l("initiating autowithdrawal", amount, to, balance, threshold);
          let w = await pay({ amount, to, user });
          withdrawal = {
            amount: fmt(-w.amount),
            link: link(w.id),
          };
        }
      } catch (e) {
        withdrawal = { failed: true };
        warn(username, "autowithdraw failed", e.message);
      }
    }

    let { paymentReceived } = t(user);
    if (user.verified && user.notify) {
      mail(user, paymentReceived, templates.paymentReceived, {
        ...t(user),
        username,
        payment: {
          amount: fmt(p.amount),
          link: link(p.id),
          tip: p.tip ? fmt(p.tip) : undefined,
          fiat: f(fiat(p.amount, p.rate), p.currency),
          fiatTip: p.tip ? f(fiat(p.tip, p.rate), p.currency) : undefined,
          memo: p.memo,
          items:
            p.items &&
            p.items.map((i) => {
              return {
                quantity: i.quantity,
                name: i.name,
                total: i.quantity * i.price,
                totalFiat: f(i.quantity * i.price, p.currency),
              };
            }),
        },
        withdrawal,
      });
    }
  }
};

let pay = async ({ aid = undefined, amount, to, user }) => {
  if (!aid) aid = user.id;
  amount = parseInt(amount) || 0;
  let lnurl, pr;
  if (to.includes("@") && to.includes(".")) {
    let [name, domain] = to.split("@");
    lnurl = `https://${domain}/.well-known/lnurlp/${name}`;
  } else if (to.startsWith("lnurl")) {
    lnurl = Buffer.from(
      bech32.fromWords(bech32.decode(to, 20000).words),
    ).toString();
  }

  let maxfee = getMaxFee(amount);
  if (lnurl) {
    amount -= maxfee;
    let { callback } = (await got(lnurl).json()) as any;
    ({ pr } = (await got(`${callback}?amount=${amount * 1000}`).json()) as any);
  } else if (to.startsWith("ln")) {
    amount -= maxfee;
    pr = to;
  }

  return pr
    ? await sendLightning({ user, pr, amount, maxfee })
    : await sendOnchain({ aid, amount, address: to, user, subtract: true });
};

export let decode = async (hex) => {
  let type, tx;
  try {
    tx = await bc.decodeRawTransaction(hex);
    type = types.bitcoin;
  } catch (e) {
    try {
      tx = await lq.decodeRawTransaction(hex);
      type = types.liquid;
    } catch (e) {
      err("invalid hex", hex);
      fail("unrecognized tx");
    }
  }

  return { tx, type };
};

let inflight = {};
export let sendOnchain = async (params) => {
  let { aid, hex, rate, user, signed } = params;
  if (!aid) aid = user.id;
  if (!hex) ({ hex } = await build(params));

  let { tx, type } = await decode(hex);
  let node =
    aid === user.id ? rpc(config[type]) : rpc({ ...config[type], wallet: aid });
  let { txid } = tx;

  try {
    if (inflight[txid]) fail("payment in flight");
    inflight[txid] = true;

    if (!signed) {
      if (config[type].walletpass)
        await node.walletPassphrase(config[type].walletpass, 300);

      ({ hex } = await node.signRawTransactionWithWallet(
        type === types.liquid ? await node.blindRawTransaction(hex) : hex,
      ));
    }

    ({ txid } = await node.decodeRawTransaction(hex));

    let r = await node.testMempoolAccept([hex]);
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
        let invoice = await g(`invoice:${address}`);
        if (invoice?.aid === aid) fail("Cannot send to internal address");

        if ((await node.getAddressInfo(address)).ismine) {
          change += sats(value);
        }
      }

      fee = totalIn - total;
    }

    let amount = total - change;

    let p = await debit({
      aid,
      hash: txid,
      amount,
      fee,
      rate,
      user,
      type,
    });

    p.hex = hex;
    await s(`payment:${p.id}`, p);

    await node.sendRawTransaction(hex);

    delete inflight[txid];
    return p;
  } catch (e) {
    delete inflight[txid];
    throw e;
  }
};

let getMaxFee = (n) =>
  Math.round(
    n < 100
      ? n * 5
      : n < 1000
        ? n
        : n < 10000
          ? n * 0.5
          : n < 100000
            ? n * 0.1
            : n < 1000000
              ? n * 0.05
              : n * 0.01,
  );

export let sendLightning = async ({
  user,
  pr,
  amount,
  maxfee,
  memo = undefined,
}) => {
  let p;

  if (typeof amount !== "undefined") {
    amount = parseInt(amount);
    if (amount < 0 || amount > SATS || isNaN(amount)) fail("Invalid amount");
  }

  let total = amount;
  let decoded = await ln.decode(pr);
  let { amount_msat } = decoded;
  if (amount_msat) total = Math.round(amount_msat / 1000);

  maxfee = parseInt(maxfee) || getMaxFee(total);

  if (maxfee < 0) fail("Max fee cannot be negative");

  let { pays } = await ln.listpays(pr);
  if (pays.find((p) => p.status === "complete"))
    fail("Invoice has already been paid");

  if (pays.find((p) => p.status === "pending"))
    fail("Payment is already underway");

  await db.sAdd("pending", pr);
  p = await debit({
    hash: pr,
    amount: total,
    fee: maxfee,
    memo,
    user,
    type: types.lightning,
  });

  l("paying lightning invoice", pr.substr(-8), total, amount, maxfee);

  let r;
  try {
    r = await ln.pay({
      bolt11: pr.replace(/\s/g, "").toLowerCase(),
      amount_msat: amount_msat ? undefined : amount * 1000,
      maxfee: maxfee * 1000,
      retry_for: 5,
    });

    try {
      if (r.status === "complete") {
        p = await finalize(r, p);
        await db.sRem("pending", pr);
      }
    } catch (e) {
      console.log("failed to process payment", e, p);
    }
  } catch (e) {
    await reverse(p);
    throw e;
  }

  return p;
};

export let sendInternal = async ({
  amount,
  invoice = undefined,
  recipient,
  sender,
}) => {
  if (!invoice)
    invoice = await generate({
      invoice: { amount, type: "lightning" },
      user: recipient,
    });

  let { hash } = invoice;
  let memo;

  let p = await debit({ hash, amount, memo, user: sender });
  await credit({ hash, amount, memo, ref: sender.id });
  return p;
};

let getAddressType = async (a) => {
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

export let build = async ({
  aid,
  amount,
  address,
  feeRate,
  subtract,
  user,
}) => {
  let type = await getAddressType(address);
  if (!aid) aid = user.id;
  let node =
    aid === user.id ? rpc(config[type]) : rpc({ ...config[type], wallet: aid });

  amount = parseInt(amount);
  if (amount < 0) fail("invalid amount");

  let fees: any = await fetch(`${api[type]}/fees/recommended`).then((r) =>
    r.json(),
  );

  if (!feeRate) {
    feeRate = fees.halfHourFee;
  }

  if (feeRate < fees.economyFee) fail("fee rate too low");

  let replaceable = false;

  let outs = [{ [address]: btc(amount) }];

  if (type === types.liquid)
    outs = outs.map((o) => ({ ...o, asset: config.liquid.btc }));

  let raw = await node.createRawTransaction([], outs, 0, replaceable);

  let fee = 0;
  let tx;

  try {
    tx = await node.fundRawTransaction(raw, {
      fee_rate: feeRate,
      replaceable,
      subtractFeeFromOutputs: [],
    });

    fee = sats(tx.fee);
  } catch (e) {
    if (e.message.startsWith("Insufficient")) subtract = true;
    else throw e;
  }

  let balance = await g(`balance:${aid}`);
  let ourfee = Math.round(amount * config.fee);
  let credit = await g(`credit:${type}:${aid}`);
  let covered = Math.min(credit, ourfee);
  ourfee -= covered;

  if (aid) ourfee = 0;
  if (subtract || amount + fee + ourfee > balance) {
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

  let inputs = [];
  let { vin } = await node.decodeRawTransaction(tx.hex);

  for (let { txid, vout } of vin) {
    let rawTx = await node.getRawTransaction(txid);
    let tx = await node.decodeRawTransaction(rawTx);
    let prevOutput = tx.vout[vout];
    let { address } = prevOutput.scriptPubKey;
    let { hdkeypath: path } = await node.getAddressInfo(address);
    let witnessUtxo = {
      amount: Math.round(prevOutput.value * SATS),
      script: prevOutput.scriptPubKey.hex,
    };
    inputs.push({ witnessUtxo, path });
  }

  return { feeRate, ourfee, fee, fees, hex: tx.hex, inputs };
};

export let catchUp = async () => {
  try {
    let txns = [];
    for (let [type, n] of Object.entries({ bitcoin: bc, liquid: lq })) {
      txns.push(
        ...(await n.listTransactions("*", 10)).filter((tx) => {
          tx.type = type;
          return tx.category === "receive" && tx.confirmations > 0;
        }),
      );
    }

    for (let { txid, type } of txns) {
      try {
        if (await db.zScore("seen", txid)) continue;
        await got.post(`http://localhost:${process.env.PORT || 3119}/confirm`, {
          json: { txid, wallet: config[type].wallet, type },
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

  setTimeout(catchUp, 10000);
};

export let reconcile = async (account, initial = false) => {
  try {
    let { descriptors, id, uid, type } = account;
    let user = await getUser(uid);
    let node = rpc({ ...config[type], wallet: id });

    let total;

    if (initial) {
      let progress = await node.scanTxOutSet("status");
      if (progress) return setTimeout(() => reconcile(account, initial), 1000);

      let { total_amount } = await node.scanTxOutSet("start", descriptors);
      total = Math.round(total_amount * SATS);
    } else {
      total = Math.round((await node.getBalance({ minconf: 1 })) * SATS);
    }

    let { balanceAdjustment: memo } = t(user);

    let balance = await g(`balance:${id}`);

    let amount = Math.abs(total - balance);
    let hash = v4();

    if (total > balance) {
      let inv = {
        memo,
        type: types.reconcile,
        hash,
        amount,
        uid,
        aid: id,
      };
      await s(`invoice:${hash}`, inv);
      await credit({
        hash,
        amount,
        type: types.reconcile,
        aid: id,
      });
    } else if (total < balance) {
      await debit({
        aid: id,
        amount,
        hash: v4(),
        memo,
        user,
        type: types.reconcile,
      });
    }
  } catch (e) {
    console.log(e);
    warn("problem reconciling", e.message, account);
    if (e.message.includes("progress"))
      return setTimeout(() => reconcile(account, initial), 1000);
  }
};

export let check = async () => {
  try {
    let payments = await db.sMembers("pending");

    for (let pr of payments) {
      let p = await getPayment(pr);
      if (!p) continue;
      let { pays } = await ln.listpays(pr);

      let failed = !pays.length || pays.every((p) => p.status === "failed");
      let completed = pays.find((p) => p.status === "complete");

      if (completed) await finalize(completed, p);
      else if (failed) await reverse(p);
    }
  } catch (e) {
    console.log("payment check failed", e);
  }

  setTimeout(check, 2000);
};

let finalize = async (r, p) => {
  await db.sRem("pending", p.hash);
  l("payment completed", p.id, r.payment_preimage);

  let maxfee = p.fee;
  p.fee = Math.round((r.amount_sent_msat - r.amount_msat) / 1000);
  p.ref = r.payment_preimage;

  await s(`payment:${p.id}`, p);

  l("refunding fee", maxfee, p.fee, maxfee - p.fee, p.ref);
  await db.incrBy(`balance:${p.uid}`, maxfee - p.fee);

  return p;
};

let reverse = async (p) => {
  let total = Math.abs(p.amount) + p.fee;
  let ourfee = p.ourfee || 0;
  let credit = Math.round(total * config.fee) - ourfee;

  let k = await db.reverse(
    `payment:${p.id}`,
    `balance:${p.uid}`,
    `credit:${types.lightning}:${p.uid}`,
    `payment:${p.hash}`,
    total,
    credit,
  );

  warn("reversed", k);
};
