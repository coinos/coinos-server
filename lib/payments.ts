import config from "$config";
import api from "$lib/api";
import { archive, db, g, ga, gf, s, sa } from "$lib/db";
import { generate } from "$lib/invoices";
import ln from "$lib/ln";
import { err, l, warn } from "$lib/logging";
import { handleZap } from "$lib/nostr";
import { notify, nwcNotify } from "$lib/notifications";
import { squarePayment } from "$lib/square";
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
import changeid from "$lib/changeid";
import rpc from "@coinos/rpc";
import { bech32 } from "bech32";
import got from "got";
import { v4 } from "uuid";


import { PaymentType } from "$lib/types";

const bc = rpc(config.bitcoin);
const lq = rpc(config.liquid);

// Throttled warn — emit at most once per WARN_THROTTLE_MS per (key, message) pair
// so a downed external service (lq, bc, etc.) doesn't flood the log every loop tick.
const WARN_THROTTLE_MS = 5 * 60 * 1000;
const warnLastEmitted: Record<string, number> = {};
const warnThrottled = (key: string, message: string) => {
  const k = `${key}|${message}`;
  const now = Date.now();
  if ((warnLastEmitted[k] || 0) + WARN_THROTTLE_MS > now) return;
  warnLastEmitted[k] = now;
  warn(`${key}:`, message);
};

// Per-asset-type async mutex. The May 18 2026 drain exploited the fact that
// the limit check + payment broadcast were non-atomic: a burst of concurrent
// withdrawals would each pass the same stale ${type}:limit value before any
// of them decremented it. This lock serializes the check + reservation per
// asset type. freezeCheck also takes the lock when overwriting limits so its
// periodic reconciliation can't race with an in-flight check.
const limitLocks: Record<string, Promise<void>> = {};
async function withLimitLock<T>(type: string, fn: () => Promise<T>): Promise<T> {
  const prev = limitLocks[type] || Promise.resolve();
  let release: () => void = () => {};
  const next = new Promise<void>((res) => { release = res; });
  limitLocks[type] = prev.then(() => next);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}
const { URL } = process.env;

const dust = 547;

export const debit = async ({
  aid = undefined,
  hash,
  amount,
  fee = 0,
  memo = undefined,
  user,
  type = PaymentType.internal,
  rate = undefined,
}) => {
  amount = Number.parseInt(amount);

  const whitelisted = await db.sIsMember(
    "whitelist",
    user?.username?.toLowerCase().trim(),
  );

  const blacklisted = await db.sIsMember(
    "blacklist",
    user?.username?.toLowerCase().trim(),
  );

  if (hash && await db.sIsMember("blocked_addresses", hash)) {
    err(`SECURITY: blocked send to ${hash} by ${user.username}`);
    await changeid(user.username);
    fail("address blocked");
  }

  const userLimit = await g("limit");
  const frozen =
    (await g("hardfreeze")) ||
    ((await g("freeze")) && type !== PaymentType.internal);

  if (frozen || (amount > userLimit && !whitelisted)) {
    warn("Blocking", user.username, amount, hash, user.id, type, frozen, userLimit);
    fail("Problem sending payment");
  }

  // Atomic check + reserve against the per-asset-type server limit. Decrement
  // immediately so concurrent calls can't reuse the same budget; freezeCheck
  // reconciles to actual on-chain balance every 10s.
  await withLimitLock(type, async () => {
    const serverLimit = Number.parseInt((await g(`${type}:limit`)) ?? "0", 10) || 0;
    if (amount > serverLimit) {
      warn("Blocking", user.username, amount, hash, user.id, type, "serverLimit", serverLimit);
      fail("Problem sending payment");
    }
    await db.decrBy(`${type}:limit`, amount);
  });

  let ref;
  const { id: uid, currency } = user;
  if (!aid) aid = uid;

  const rates = await g("rates");
  if (!rate) rate = rates[currency];

  const invoice = await getInvoice(hash);
  let iid;

  if (invoice) {
    if (invoice.received >= amount && invoice.type !== PaymentType.bolt12)
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

  const tip = Number.parseInt(invoice?.tip) || null;
  if (tip < 0) fail("Invalid tip");

  if (!amount || amount < 0) fail("Amount must be greater than zero");

  let creditType = type;
  if (creditType === PaymentType.bolt12) creditType = PaymentType.lightning;
  let ourfee: any = [
    PaymentType.bitcoin,
    PaymentType.liquid,
    PaymentType.lightning,
  ].includes(type)
    ? Math.round((amount + fee + tip) * config.fee[creditType])
    : 0;

  if (aid !== uid) ourfee = 0;
  const frozenBalance =
    !blacklisted || whitelisted ? 0 : await g(`balance:${uid}`);

  ourfee = await db.debit(
    `balance:${aid}`,
    `credit:${creditType}:${aid !== uid ? 0 : uid}`,
    t(user).insufficientFunds,
    amount || 0,
    tip || 0,
    fee || 0,
    ourfee || 0,
    frozenBalance || 0,
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
    .lPush("payments", id)
    .lPush(`${aid || uid}:payments`, id)
    .set(`${aid || uid}:payments:last`, p.created)
    .exec();

  l(user.username, "sent", type, amount);
  if (![PaymentType.lightning, PaymentType.bolt12].includes(type)) nwcNotify(p);

  return p;
};

export const credit = async ({
  hash,
  amount,
  memo = "",
  ref = "",
  type = PaymentType.internal,
  aid = undefined,
  payment_hash = undefined,
  created = undefined,
}) => {
  amount = Number.parseInt(amount) || 0;

  let inv = await getInvoice(hash);
  if (!inv && type === PaymentType.bolt12) {
    const { invoices } = await ln.listinvoices({ invstring: hash });
    const { local_offer_id } = invoices[0];
    inv = await getInvoice(local_offer_id);
  }

  if (!inv) {
    await db.sAdd("missing", ref.split(":")[0]);
    return;
  }

  let { path, tip } = inv;
  tip = Number.parseInt(tip) || 0;

  if (!memo) ({ memo } = inv);
  if (memo && memo.length > 5000) fail("memo too long");
  if (amount < 0 || tip < 0) fail("Invalid amount");
  if (type === PaymentType.internal) amount += tip;

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
    payment_hash,
    ref,
    tip,
    type,
    confirmed: true,
    created: created || Date.now(),
    items: undefined,
  };

  if ([PaymentType.bitcoin, PaymentType.liquid].includes(type))
    inv.pending += amount;
  else {
    inv.received += amount;
    inv.preimage = ref;
    inv.settled = Date.now();
  }

  let balanceKey = "balance";
  if ([PaymentType.bitcoin, PaymentType.liquid].includes(type)) {
    const [txid, vout] = ref.split(":").slice(-2);
    p.confirmed = false;
    balanceKey = "pending";
    await s(`payment:${txid}:${vout}`, id);
    // Mirror the txid:vout pointer into arc so future bulk /confirm sweeps find
    // the prior credit via gf() fallback and don't double-credit. See
    // feedback_apr29_double_credit_incident.md for the incident this prevents.
    await sa(`payment:${txid}:${vout}`, id);
  } else {
    await s(`payment:${hash}`, id);
    await sa(`payment:${hash}`, id);
  }

  const m = await db.multi();

  let creditType = type;
  if (creditType === PaymentType.bolt12) creditType = PaymentType.lightning;
  if (
    [PaymentType.bitcoin, PaymentType.liquid, PaymentType.lightning].includes(
      creditType,
    )
  )
    m.incrBy(
      `credit:${creditType}:${uid}`,
      Math.round(amount * config.fee[creditType]),
    );

  m.set(`invoice:${inv.id}`, JSON.stringify(inv))
    .set(`payment:${p.id}`, JSON.stringify(p))
    .lPush(`${aid || uid}:payments`, p.id)
    .incrBy(`${balanceKey}:${aid || uid}`, amount)
    .set(`${aid || uid}:payments:last`, p.created)
    .exec();

  // Mirror the payment record + invoice into arc for the same protection.
  await sa(`payment:${p.id}`, p);
  await sa(`invoice:${inv.id}`, inv);

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
        withdrawal = { failed: true };
        warn(username, "autowithdraw failed", e.message);
      }
    }
  }

  nwcNotify(p);
  notify(p, user, withdrawal);

  squarePayment(p, user);

  l(username, "received", p.type, p.amount);
  callWebhook(inv, p);
};

const pay = async ({ aid = undefined, amount, to, user }) => {
  if (!aid) aid = user.id;
  amount = Number.parseInt(amount) || 0;
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

  const fee = Math.max(5, Math.round(amount * 0.02));
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
    type = PaymentType.bitcoin;
  } catch (e) {
    try {
      tx = await lq.decodeRawTransaction(hex);
      type = PaymentType.liquid;
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
        type === PaymentType.liquid ? await node.blindRawTransaction(hex) : hex,
      ));
    }

    ({ txid } = await node.decodeRawTransaction(hex));

    const r = await node.testMempoolAccept([hex]);
    if (!r[0].allowed) fail("transaction rejected");

    let total = 0;
    let fee = 0;
    let change = 0;

    if (type === PaymentType.liquid) {
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
        const invoice = await getInvoice(address);
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
    // Release UTXOs that build() locked, so the user can retry without abandoning coins.
    try {
      const vin = tx?.vin?.map(({ txid, vout }) => ({ txid, vout })) ?? [];
      if (vin.length) await node.lockUnspent(true, vin);
    } catch {}
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
  fee = Math.max(Number.parseInt(fee || amount * 0.005), 5);

  let p = await gf(`payment:${hash}`);
  if (p) fail("duplicate keysend");

  p = await debit({
    hash,
    amount,
    fee,
    memo,
    user,
    type: PaymentType.lightning,
  });

  try {
    return await ln.keysend({
      destination: pubkey,
      amount_msat: amount * 1000,
      maxfee: fee * 1000,
      retry_for: 10,
      extratlvs,
    });
  } catch (e) {
    try { await reverse(p); } catch (_) {}
    throw e;
  }
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
    amount = Number.parseInt(amount);
    if (amount < 0 || amount > SATS || Number.isNaN(amount)) {
      warn("invalid amount", amount);
      fail("Invalid amount");
    }
  }

  let { type, invoice_amount_msat, amount_msat, invoice_node_id, payee } =
    await ln.decode(pr);
  if (type.includes("bolt12")) {
    amount_msat = invoice_amount_msat;
    payee = invoice_node_id;
  }

  const amt = amount_msat ? Math.round(amount_msat / 1000) : amount;
  let minfee = Math.max(5, Math.round(amt * 0.005));
  const { channels } = await ln.listpeerchannels();
  if (channels.some((c) => c.peer_id === payee)) minfee = 0;

  fee = Math.max(Number.parseInt(fee) || minfee, minfee);
  if (fee < 0) fail("Fee cannot be negative");

  const { pays } = await ln.listpays(pr);
  if (pays.find((p) => p.status === "complete"))
    fail("Invoice has already been paid");

  if (pays.find((p) => p.status === "pending"))
    fail("Payment is already underway");

  p = await debit({
    hash: pr,
    amount: amount_msat ? Math.round(amount_msat / 1000) : amount,
    fee,
    memo,
    user,
    type: PaymentType.lightning,
  });

  await db.sAdd("pending", pr);

  l("paying lightning invoice", pr.substr(-8), amount, fee);

  try {
    const r = await ln.xpay({
      invstring: pr.replace(/\s/g, "").toLowerCase(),
      // bolt11: pr.replace(/\s/g, "").toLowerCase(),
      amount_msat: amount_msat ? undefined : amount * 1000,
      maxfee: fee * 1000,
      retry_for: 30,
      layers: ["prefer-kappa"],
    });

    try {
      if (!r.failed_parts) p = await finalize(r, p);
    } catch (e) {
      warn("failed to process payment", p.id);
    }
  } catch (e) {
    err("failed to pay", pr.substr(-8));
    try {
      const { pays } = await ln.listpays(pr);
      const completed = pays.find((p) => p.status === "complete");
      if (completed) {
        warn("payment completed despite error, finalizing", p.id);
        try { await finalize(completed, p); } catch (_) {}
      } else {
        await reverse(p);
      }
    } catch (_) {}
    throw e;
  }

  return p;
};

export const sendInternal = async ({
  amount,
  invoice = undefined,
  memo = undefined,
  recipient,
  sender,
}) => {
  if (!invoice)
    invoice = await generate({
      invoice: { amount, type: "lightning" },
      user: recipient,
    });

  const { hash } = invoice;
  const p = await debit({ hash, amount, memo, user: sender });
  await credit({ hash, amount, memo, ref: sender.id });

  if (invoice.memo?.includes("9734")) {
    const { invoices } = await ln.listinvoices({ invstring: hash });
    const inv = invoices[0];
    inv.payment_preimage = p.id;
    inv.paid_at = Math.floor(Date.now() / 1000);
    handleZap(inv, sender.pubkey).catch(console.log);
  }

  return p;
};

const getAddressType = async (a) => {
  try {
    await bc.getAddressInfo(a);
    return PaymentType.bitcoin;
  } catch (e) {
    try {
      await lq.getAddressInfo(a);
      return PaymentType.liquid;
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

  amount = Number.parseInt(amount);
  if (amount < 0) fail("invalid amount");

  const fees: any =
    type === PaymentType.liquid
      ? { fastestFee: 0.1, halfHourFee: 0.1, hourFee: 0.1 }
      : await fetch(`${api[type]}/fees/recommended`).then((r) => r.json());

  if (type === PaymentType.bitcoin) {
    fees.hourFee = fees.halfHourFee;
    fees.halfHourFee = fees.fastestFee;
    fees.fastestFee = Math.ceil(fees.fastestFee * 1.5);
  }

  if (!feeRate) {
    feeRate = fees.halfHourFee;
  }

  if (feeRate < fees.hourFee) fail("fee rate too low");

  const replaceable = false;

  let outs = [{ [address]: btc(amount) }];

  if (type === PaymentType.liquid)
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
  let ourfee = Math.round(amount * config.fee[type]);
  const credit = await g(`credit:${type}:${aid}`);
  const covered = Math.min(credit, ourfee);
  ourfee -= covered;

  if (aid && aid !== user.id) ourfee = 0;
  if (subtract || amount + fee + ourfee > balance) {
    subtract = true;
    if (amount <= fee + ourfee + dust) {
      fail(
        `insufficient funds ⚡️${balance} of ⚡️${amount + fee + ourfee + dust}`,
      );
    }

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

  // Reserve selected UTXOs so concurrent builds don't pick the same inputs.
  // Locks are in-memory only; cleared on bitcoind restart. sendOnchain unlocks on broadcast failure.
  try {
    await node.lockUnspent(
      false,
      vin.map(({ txid, vout }) => ({ txid, vout })),
    );
  } catch (e: any) {
    warn("lockUnspent failed", e.message);
  }

  return { feeRate, ourfee, fee, fees, hex: tx.hex, inputs, subtract };
};

export const catchUp = async () => {
  try {
    const txns = [];
    for (const [type, n] of Object.entries({ bitcoin: bc, liquid: lq })) {
      txns.push(
        ...(await n.listTransactions("*", 100)).filter((tx) => {
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

  setTimeout(catchUp, 30000);
};

export const check = async () => {
  if (process.env.URL.includes("dev")) return;
  try {
    const payments = await db.sMembers("pending");

    for (const pr of payments) {
      if (!pr.startsWith("ln")) {
        await db.sRem("pending", pr);
        continue;
      }
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
        if (e.message?.includes("already been reversed")) {
          await db.sRem("pending", p.hash);
        }
      }
    }
  } catch (e) {
    err("payment check failed", e.message);
  }

  setTimeout(check, 5000);
};

const finalize = async (r, p) => {
  let { preimage } = r;
  if (!preimage) preimage = r.payment_preimage;
  if (!preimage) fail("missing preimage");

  await db.sRem("pending", p.hash);
  l("payment completed", p.id, r.payment_preimage);
  nwcNotify(p);

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
  const credit = Math.round(total * config.fee[PaymentType.lightning]) - ourfee;

  l("reversing", p.id, p.amount, p.fee, total, ourfee, credit);

  await db.reverse(
    `payment:${p.id}`,
    `balance:${p.uid}`,
    `credit:${PaymentType.lightning}:${p.uid}`,
    `payment:${p.hash}`,
    `${p.uid}:payments`,
    p.id,
    total,
    credit,
    p.hash,
  );

  warn("reversed", p.id);
};

const freezeCheck = async () => {
  // Each asset is fetched independently so e.g. lq being unreachable doesn't
  // prevent lightning and bitcoin limits from refreshing.
  let lnbalance: number | undefined;
  try {
    const funds = await ln.listfunds();
    lnbalance = Math.round(
      funds.channels.reduce((a, b) => a + b.our_amount_msat, 0) / 1000,
    );
  } catch (e: any) {
    warnThrottled("freezeCheck lightning", e.message);
  }

  let bcbalance: number | undefined;
  try {
    bcbalance = Math.round((await bc.getBalance()) * SATS);
  } catch (e: any) {
    warnThrottled("freezeCheck bitcoin", e.message);
  }

  let lqbalance: number | undefined;
  try {
    const { bitcoin } = await lq.getBalance();
    lqbalance = Math.round(bitcoin * SATS);
  } catch (e: any) {
    warnThrottled("freezeCheck liquid", e.message);
  }

  if (lnbalance !== undefined) {
    const lnthreshold = await g("lightning:threshold");
    const lim = Math.max(lnbalance - lnthreshold, 0);
    for (const t of ["lightning", "fund", "ecash", "bolt12"]) {
      await withLimitLock(t, async () => { await s(`${t}:limit`, lim); });
    }
  }
  if (bcbalance !== undefined) {
    const bcthreshold = await g("bitcoin:threshold");
    await withLimitLock("bitcoin", async () => {
      await s("bitcoin:limit", Math.max(bcbalance - bcthreshold, 0));
    });
  }
  if (lqbalance !== undefined) {
    const lqthreshold = await g("liquid:threshold");
    await withLimitLock("liquid", async () => {
      await s("liquid:limit", Math.max(lqbalance - lqthreshold, 0));
    });
  }

  setTimeout(freezeCheck, 10000);
};
freezeCheck();
