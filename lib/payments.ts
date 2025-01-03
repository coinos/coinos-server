import config from "$config";
import api from "$lib/api";
import { db, g, s } from "$lib/db";
import { generate } from "$lib/invoices";
import ln from "$lib/ln";
import { err, l, warn } from "$lib/logging";
import { notify } from "$lib/notifications";
import {
  SATS,
  btc,
  fail,
  fmt,
  formatReceipt,
  getInvoice,
  getPayment,
  getUser,
  link,
  sats,
  sleep,
  t,
} from "$lib/utils";
import { callWebhook } from "$lib/webhooks";
import rpc from "@coinos/rpc";
import { bech32 } from "bech32";
import got from "got";
import { v4 } from "uuid";

const bc = rpc(config.bitcoin);
const lq = rpc(config.liquid);
const { URL } = process.env;

const dust = 547;

export const types = {
  internal: "internal",
  bitcoin: "bitcoin",
  lightning: "lightning",
  fund: "fund",
  liquid: "liquid",
  ecash: "ecash",
  reconcile: "reconcile",
  bolt12: "bolt12",
};

export const debit = async ({
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
  const { id: uid, currency } = user;

  const rates = await g("rates");
  if (!rate) rate = rates[currency];

  const invoice = await getInvoice(hash);
  let iid;

  if (invoice) {
    if (invoice.received >= amount && invoice.type !== types.bolt12)
      fail("Invoice already paid");
    ({ id: iid } = invoice);

    ref = invoice.uid;

    const equivalentRate =
      invoice.rate * (rates[currency] / rates[invoice.currency]);

    if (Math.abs(invoice.rate / rates[invoice.currency] - 1) < 0.01) {
      rate = equivalentRate;
    } else {
      warn("rate slipped", hash, invoice.rate, equivalentRate);
    }
  }

  const tip = parseInt(invoice?.tip) || null;
  if (tip < 0) fail("Invalid tip");

  if (!amount || amount < 0) fail("Amount must be greater than zero");

  let creditType = type;
  if (creditType === types.bolt12) creditType = types.lightning;
  let ourfee: any = [types.bitcoin, types.liquid, types.lightning].includes(
    type,
  )
    ? Math.round((amount + fee + tip) * config.fee)
    : 0;

  if (aid) ourfee = 0;

  ourfee = await db.debit(
    `balance:${aid || uid}`,
    `credit:${creditType}:${aid ? 0 : uid}`,
    amount || 0,
    tip || 0,
    fee || 0,
    ourfee || 0,
  );

  if (ourfee.err) fail(ourfee.err);

  const id = v4();
  const p = {
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
    confirmed: true,
    rate,
    currency,
    type,
    ref,
    tip,
    created: Date.now(),
  };

  await s(`payment:${hash}`, id);
  await s(`payment:${id}`, p);
  await db
    .multi()
    .lPush(`${aid || uid}:payments`, id)
    .set(`${aid || uid}:payments:last`, p.created)
    .exec();

  l(user.username, "sent", type, amount);
  //emit(user.id, "payment", p);

  return p;
};

export const credit = async ({
  hash,
  amount,
  memo = "",
  ref = "",
  type = types.internal,
  aid = undefined,
}) => {
  amount = parseInt(amount) || 0;

  let inv;
  if (type === types.bolt12) {
    const { invoices } = await ln.listinvoices({ invstring: hash });
    const { local_offer_id } = invoices[0];
    inv = await getInvoice(local_offer_id);
  } else {
    inv = await getInvoice(hash);
  }

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

  const user = await getUser(inv.uid);
  const { id: uid, currency } = user;

  const rates = await g("rates");
  let rate = rates[currency];

  if (!rate) await sleep(1000);
  rate = rates[currency];

  const equivalentRate = inv.rate * (rates[currency] / rates[inv.currency]);

  if (Math.abs(inv.rate / rates[inv.currency] - 1) < 0.01) {
    rate = equivalentRate;
  } else {
    // warn("rate slipped", hash, invoice.rate, equivalentRate);
  }

  const id = v4();
  const p = {
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
    const [txid, vout] = ref.split(":").slice(-2);
    p.confirmed = false;
    balanceKey = "pending";
    await s(`payment:${txid}:${vout}`, id);
  } else {
    await s(`payment:${hash}`, id);
  }

  const m = await db.multi();

  let creditType = type;
  if (creditType === types.bolt12) creditType = types.lightning;
  if ([types.bitcoin, types.liquid, types.lightning].includes(creditType))
    m.incrBy(`credit:${creditType}:${uid}`, Math.round(amount * config.fee));

  m.set(`invoice:${inv.id}`, JSON.stringify(inv))
    .set(`payment:${p.id}`, JSON.stringify(p))
    .lPush(`${aid || uid}:payments`, p.id)
    .incrBy(`${balanceKey}:${aid || uid}`, amount)
    .set(`${aid || uid}:payments:last`, p.created)
    .exec();

  if (inv.items?.length) {
    formatReceipt(inv.items, inv.currency);
    p.items = inv.items;
  }

  await completePayment(inv, p, user);

  return p;
};

export const completePayment = async (inv, p, user) => {
  const { id, autowithdraw, threshold, reserve, destination, username } = user;
  let withdrawal;
  if (p.confirmed) {
    if (autowithdraw) {
      try {
        const to = destination.trim();
        const balance = await g(`balance:${id}`);
        const amount = balance - reserve;
        if (balance > threshold) {
          l("initiating autowithdrawal", amount, to, balance, threshold);
          const w = await pay({ amount, to, user });
          withdrawal = {
            amount: fmt(-w.amount),
            link: link(w.id),
          };
        }
      } catch (e) {
        console.log(e);
        withdrawal = { failed: true };
        warn(username, "autowithdraw failed", e.message);
      }
    }
  }

  notify(p, user, withdrawal);
  l(username, "received", p.type, p.amount);
  callWebhook(inv, p);
};

const pay = async ({ aid = undefined, amount, to, user }) => {
  if (!aid) aid = user.id;
  amount = parseInt(amount) || 0;
  let lnurl;
  let pr;
  if (to.includes("@") && to.includes(".")) {
    const [name, domain] = to.split("@");
    if (URL.includes(domain)) to = name;
    lnurl = `https://${domain}/.well-known/lnurlp/${name}`;
  } else if (to.startsWith("lnurl")) {
    lnurl = Buffer.from(
      bech32.fromWords(bech32.decode(to, 20000).words),
    ).toString();
  }

  const recipient = await getUser(to);
  if (recipient)
    return sendInternal({
      amount,
      recipient,
      sender: user,
    });

  const fee = Math.max(5, Math.round(amount * 0.005));
  if (lnurl) {
    amount -= fee;
    const { callback } = (await got(lnurl).json()) as any;
    ({ pr } = (await got(`${callback}?amount=${amount * 1000}`).json()) as any);
  } else if (to.startsWith("ln")) {
    amount -= fee;
    pr = to;
  }

  return pr
    ? await sendLightning({ user, pr, amount, fee })
    : await sendOnchain({ aid, amount, address: to, user, subtract: true });
};

export const decode = async (hex) => {
  let type;
  let tx;
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

const inflight = {};
export const sendOnchain = async (params) => {
  let { aid, hex, rate, user, signed } = params;
  if (!aid) aid = user.id;
  if (!hex) ({ hex } = await build(params));

  const { tx, type } = await decode(hex);
  const node =
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

    const r = await node.testMempoolAccept([hex]);
    if (!r[0].allowed) fail("transaction rejected");

    let total = 0;
    let fee = 0;
    let change = 0;

    if (type === types.liquid) {
      for (const {
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
      for await (const { txid, vout } of tx.vin) {
        const hex = await node.getRawTransaction(txid);
        const tx = await node.decodeRawTransaction(hex);
        totalIn += sats(tx.vout[vout].value);
      }

      for (const {
        scriptPubKey: { address },
        value,
      } of tx.vout) {
        total += sats(value);
        const invoice = await g(`invoice:${address}`);
        if (invoice?.aid === aid) fail("Cannot send to internal address");

        if ((await node.getAddressInfo(address)).ismine) {
          change += sats(value);
        }
      }

      fee = totalIn - total;
    }

    const amount = total - change;

    const p = await debit({
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

export const sendKeysend = async ({
  hash,
  amount,
  pubkey,
  fee = undefined,
  memo = undefined,
  user,
  extratlvs = undefined,
}) => {
  fee = Math.max(parseInt(fee || amount * 0.005), 5);

  let p = await g(`payment:${hash}`);
  if (p) fail("duplicate keysend");

  p = await debit({
    hash,
    amount,
    fee,
    memo,
    user,
    type: types.lightning,
  });

  const r = await ln.keysend({
    destination: pubkey,
    amount_msat: amount * 1000,
    maxfee: fee * 1000,
    retry_for: 10,
    extratlvs,
  });

  if (r.status !== "complete") reverse(p);

  return r;
};

export const sendLightning = async ({
  user,
  pr,
  amount,
  fee = undefined,
  memo = undefined,
}) => {
  let p;

  if (typeof amount !== "undefined") {
    amount = parseInt(amount);
    if (amount < 0 || amount > SATS || Number.isNaN(amount))
      fail("Invalid amount");
  }

  const total = amount;
  const decoded = await ln.decode(pr);
  const amount_msat = decoded.type.includes("bolt12")
    ? decoded.invoice_amount_msat
    : decoded.amount_msat;

  fee = Math.max(parseInt(fee || 0), 5);
  if (fee < 0) fail("Fee cannot be negative");

  const { pays } = await ln.listpays(pr);
  if (pays.find((p) => p.status === "complete"))
    fail("Invoice has already been paid");

  if (pays.find((p) => p.status === "pending"))
    fail("Payment is already underway");

  p = await debit({
    hash: pr,
    amount: total,
    fee,
    memo,
    user,
    type: types.lightning,
  });

  await db.sAdd("pending", pr);

  l("paying lightning invoice", pr.substr(-8), total, amount, fee);

  try {
    const r = await ln.xpay({
      invstring: pr.replace(/\s/g, "").toLowerCase(),
      // bolt11: pr.replace(/\s/g, "").toLowerCase(),
      amount_msat: amount_msat ? undefined : amount * 1000,
      maxfee: fee * 1000,
      retry_for: 10,
    });

    try {
      if (!r.failed_parts) p = await finalize(r, p);
    } catch (e) {
      warn("failed to process payment", p.id);
    }
  } catch (e) {
    err("failed to pay", pr.substr(-8));
    reverse(p);
    throw e;
  }

  return p;
};

export const sendInternal = async ({
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

  const { hash } = invoice;
  let memo;

  const p = await debit({ hash, amount, memo, user: sender });
  await credit({ hash, amount, memo, ref: sender.id });
  return p;
};

const getAddressType = async (a) => {
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

export const build = async ({
  aid,
  amount,
  address,
  feeRate,
  subtract,
  user,
}) => {
  const type = await getAddressType(address);
  if (!aid) aid = user.id;
  const node =
    aid === user.id ? rpc(config[type]) : rpc({ ...config[type], wallet: aid });

  amount = parseInt(amount);
  if (amount < 0) fail("invalid amount");

  const fees: any =
    type === types.liquid
      ? { fastestFee: 0.1, halfHourFee: 0.1, hourFee: 0.1 }
      : await fetch(`${api[type]}/fees/recommended`).then((r) => r.json());

  fees.hourFee = fees.halfHourFee;
  fees.halfHourFee = fees.fastestFee;

  if (type === types.bitcoin) {
    fees.fastestFee = Math.round(fees.fastestFee * 1.1);
    if (fees.fastestFee === fees.halfHourFee) fees.fastestFee++;
    if (fees.hourFee === fees.halfHourFee) fees.hourFee--;
  }

  if (!feeRate) {
    feeRate = fees.halfHourFee;
  }

  if (feeRate < fees.hourFee) fail("fee rate too low");

  const replaceable = false;

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

  const balance = await g(`balance:${aid}`);
  let ourfee = Math.round(amount * config.fee);
  const credit = await g(`credit:${type}:${aid}`);
  const covered = Math.min(credit, ourfee);
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

  const inputs = [];
  const { vin } = await node.decodeRawTransaction(tx.hex);

  for (const { txid, vout } of vin) {
    const rawTx = await node.getRawTransaction(txid);
    const tx = await node.decodeRawTransaction(rawTx);
    const prevOutput = tx.vout[vout];
    const { address } = prevOutput.scriptPubKey;
    const { hdkeypath: path } = await node.getAddressInfo(address);
    const witnessUtxo = {
      amount: Math.round(prevOutput.value * SATS),
      script: prevOutput.scriptPubKey.hex,
    };
    inputs.push({ witnessUtxo, path });
  }

  return { feeRate, ourfee, fee, fees, hex: tx.hex, inputs };
};

export const catchUp = async () => {
  try {
    const txns = [];
    for (const [type, n] of Object.entries({ bitcoin: bc, liquid: lq })) {
      txns.push(
        ...(await n.listTransactions("*", 10)).filter((tx) => {
          tx.type = type;
          return tx.category === "receive" && tx.confirmations > 0;
        }),
      );
    }

    for (const { txid, type } of txns) {
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

export const reconcile = async (account, initial = false) => {
  try {
    const { descriptors, id, uid, type } = account;
    const user = await getUser(uid);
    const node = rpc({ ...config[type], wallet: id });

    let total;

    if (initial) {
      const progress = await node.scanTxOutSet("status");
      if (progress) return setTimeout(() => reconcile(account, initial), 1000);

      const { total_amount } = await node.scanTxOutSet("start", descriptors);
      total = Math.round(total_amount * SATS);
    } else {
      total = Math.round((await node.getBalance({ minconf: 1 })) * SATS);
    }

    const { balanceAdjustment: memo } = t(user);

    const balance = await g(`balance:${id}`);

    const amount = Math.abs(total - balance);
    const hash = v4();

    if (total > balance) {
      const inv = {
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

export const check = async () => {
  try {
    const payments = await db.sMembers("pending");

    for (const pr of payments) {
      const p = await getPayment(pr);
      if (!p || Date.now() - p.created < 10000) continue;
      const { pays } = await ln.listpays(pr);

      const failed = !pays.length || pays.every((p) => p.status === "failed");
      const completed = pays.find((p) => p.status === "complete");

      try {
        if (completed) await finalize(completed, p);
        else if (failed) await reverse(p);
      } catch (e) {
        err("failed to finalize", p.id, e.message);
      }
    }
  } catch (e) {
    err("payment check failed", e.message);
  }

  setTimeout(check, 2000);
};

const finalize = async (r, p) => {
  let { preimage } = r;
  if (!preimage) preimage = r.payment_preimage;
  if (!preimage) fail("missing preimage");

  await db.sRem("pending", p.hash);
  l("payment completed", p.id, r.payment_preimage);

  const maxfee = p.fee;
  const { amount_msat } = await ln.decode(p.hash);
  p.fee = Math.round((r.amount_sent_msat - amount_msat) / 1000);
  p.ref = preimage;

  if (!(await g(`payment:${p.id}`)).ref) {
    await s(`payment:${p.id}`, p);

    l("refunding fee", maxfee, p.fee, maxfee - p.fee, p.ref);
    await db.incrBy(`balance:${p.uid}`, maxfee - p.fee);
  }

  return p;
};

const reverse = async (p) => {
  await sleep(Math.floor(Math.random() * (1500 - 500 + 1)) + 500);

  const total = Math.abs(p.amount) + p.fee + p.ourfee;
  const ourfee = p.ourfee || 0;
  const credit = Math.round(total * config.fee) - ourfee;

  l("reversing", p.id, p.amount, p.fee, total, ourfee, credit);

  await db.reverse(
    `payment:${p.id}`,
    `balance:${p.uid}`,
    `credit:${types.lightning}:${p.uid}`,
    `payment:${p.hash}`,
    `${p.uid}:payments`,
    p.id,
    total,
    credit,
    p.hash,
  );

  warn("reversed", p.id);
};
