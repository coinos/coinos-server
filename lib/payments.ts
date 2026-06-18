import config from "$config";
import { existsSync } from "fs";
import api from "$lib/api";
import { archive, db, g, ga, gf, s, sa } from "$lib/db";

// External-withdrawal lockfiles. Out-of-band emergency stop: nobal.sh (or a
// human) can `touch /home/adam/locks/<type>.locked` on the host, which is
// bind-mounted into this container at /locks. Existence of /locks/<type>.locked
// (or /locks/ALL.locked) blocks all external sends of that type. Lives outside
// db so it can't be disabled by a db-write vector (May 18 /gateway lesson).
//
// Internal payments are never blocked by these — receives and internal
// transfers between coinos users keep working with the site fully online.
const isWithdrawLocked = (type: string): string | null => {
  if (existsSync("/locks/ALL.locked")) return "ALL";
  if (existsSync(`/locks/${type}.locked`)) return type;
  return null;
};
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

// Fire-and-forget: push a freshly-broadcast tx straight to public explorers so
// they see it immediately instead of waiting for it to propagate to their node
// over the p2p network (measured ~8s otherwise). Never throws; never blocks.
const broadcastToExplorers = (hex: string) => {
  const net = config.bitcoin?.network;
  if (net === "regtest" || net === "testnet") return; // public explorers are mainnet
  for (const base of ["https://mempool.space/api", "https://blockstream.info/api"]) {
    fetch(`${base}/tx`, {
      method: "POST",
      body: hex,
      headers: { "Content-Type": "text/plain" },
    }).catch(() => {});
  }
};

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

  // Blacklist (freeze) matches on EITHER the current username OR the uid. The
  // uid never changes, so renaming the account can't shake the freeze — add the
  // uid to the `blacklist` set to freeze a compromised account durably.
  const blacklisted =
    (await db.sIsMember("blacklist", user?.username?.toLowerCase().trim())) ||
    (!!user?.id && (await db.sIsMember("blacklist", user.id)));

  if (hash && await db.sIsMember("blocked_addresses", hash)) {
    err(`SECURITY: blocked send to ${hash} by ${user.username}`);
    await changeid(user.username);
    fail("address blocked");
  }

  const userLimit = await g("limit");
  const frozen =
    (await g("hardfreeze")) ||
    ((await g("freeze")) && type !== PaymentType.internal);

  // Out-of-band withdrawal lock (file-based, can't be defeated by db writes).
  // Internal sends are exempt — they don't touch external wallets.
  if (type !== PaymentType.internal) {
    const lockedKind = isWithdrawLocked(type);
    if (lockedKind) {
      warn("Blocking", user.username, amount, hash, user.id, type, "withdraw-lock", lockedKind);
      fail("External withdrawals temporarily disabled");
    }
  }

  if (frozen || (amount > userLimit && !whitelisted)) {
    warn("Blocking", user.username, amount, hash, user.id, type, frozen, userLimit);
    fail("Problem sending payment");
  }

  // Atomic check + reserve against the per-asset-type server limit. Decrement
  // immediately so concurrent calls can't reuse the same budget; freezeCheck
  // reconciles to actual on-chain balance every 10s.
  //
  // Internal sends are exempt: they're pure ledger moves between coinos users
  // and never touch an external wallet, so there's no hot-wallet liquidity to
  // reserve against. freezeCheck only ever populates limits for external types
  // (lightning/fund/ecash/bolt12/bitcoin/liquid), so `internal:limit` stays 0
  // forever — applying the check here blocks every internal payment.
  if (type !== PaymentType.internal) {
    await withLimitLock(type, async () => {
      const serverLimit = Number.parseInt((await g(`${type}:limit`)) ?? "0", 10) || 0;
      if (amount > serverLimit) {
        warn("Blocking", user.username, amount, hash, user.id, type, "serverLimit", serverLimit);
        fail("Problem sending payment");
      }
      await db.decrBy(`${type}:limit`, amount);
    });
  }

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

  // Idempotency guard for external settlements. The getPayment() pre-check in
  // the lightning listener/replay is not atomic: N concurrent re-credits of the
  // same payment all read it as uncredited before any writes the pointer, so
  // each runs the incrBy below — the /replay double-credit race. SET NX is
  // atomic, so only the first caller claims the settlement and credits; the rest
  // bail here, before the incrBy. `ref` is the lightning preimage, unique per
  // settlement; internal/fund/ecash pass ref=uid and are exempt.
  if ([PaymentType.lightning, PaymentType.bolt12].includes(type) && ref) {
    const claimed = await db.set(`credited:${ref}`, id, { NX: true });
    if (!claimed) {
      warn("duplicate credit blocked", hash, ref);
      return;
    }
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

  // completePayment runs at two lifecycle points for on-chain (bitcoin/liquid)
  // deposits — once when the tx is first seen (pending) and again from /confirm
  // when it confirms — plus once for instant lightning receives. Logging a bare
  // "received" at each made a single on-chain deposit look like two receives in
  // the logs (it never double-credited — the /confirm `p.confirmed` guard and
  // the `seen` set prevent that; it was only noisy/misleading). Distinguish the
  // states so the log reads as one deposit moving pending -> confirmed.
  const stage = p.confirmed ? "received" : "receiving (pending)";
  l(username, stage, p.type, p.amount);
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

    // Reserve UTXOs to keep concurrent sends from selecting the same inputs.
    // Released in the catch block on failure; spent UTXOs make the lock moot on success.
    try {
      const lockVin = tx.vin.map(({ txid, vout }) => ({ txid, vout }));
      if (lockVin.length) await node.lockUnspent(false, lockVin);
    } catch (e: any) {
      warn("lockUnspent failed", e.message);
    }

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
    broadcastToExplorers(hex);

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

  let outcome = "unknown";
  try {
    const r = await ln.keysend({
      destination: pubkey,
      amount_msat: amount * 1000,
      maxfee: fee * 1000,
      retry_for: 10,
      extratlvs,
    });
    warn("keysend returned", p.id, JSON.stringify({
      status: r?.status,
      has_preimage: !!(r?.payment_preimage ?? r?.preimage),
      amount_sent_msat: r?.amount_sent_msat,
    }));
    outcome = "keysend-returned";  // success path — caller handles preimage polling
    l("sendKeysend outcome", p.id, "=", outcome);
    return r;
  } catch (e: any) {
    err("failed keysend", hash?.slice(0,16), "error:", e?.message);
    try {
      const { pays } = await ln.listpays({ payment_hash: hash });
      warn("listpays after keysend-threw", p.id, JSON.stringify(pays?.map((x) => ({ status: x.status, amount_sent_msat: x.amount_sent_msat })) ?? []));
      const completed = pays.find((x) => x.status === "complete");
      const failed = !pays.length || pays.every((x) => x.status === "failed");
      if (completed) {
        outcome = "keysend-completed-despite-throw";
      } else if (failed) {
        await reverse(p);
        outcome = "reversed-after-keysend-throw";
      } else {
        outcome = "pending-after-keysend-throw";
      }
      // else: pending or completed — leave the debit; check() loop will
      // reconcile. Reversing on pending would refund while CLN may still
      // settle the keysend.
    } catch (verifyErr: any) {
      warnThrottled("listpays verification failed (keysend)", verifyErr?.message ?? String(verifyErr));
      outcome = "verify-failed-after-keysend-throw";
    }
    warn("sendKeysend outcome", p.id, "=", outcome);
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

  // Instrumentation: track which exit path the payment took so we can
  // diagnose any future stuck "optimistic" cases (confirmed=true with no
  // ref, no pending-set membership). Logged just before the function
  // returns; if "outcome=unsettled" appears in the logs we have a leak.
  let outcome = "unknown";

  try {
    const r = await ln.xpay({
      invstring: pr.replace(/\s/g, "").toLowerCase(),
      // bolt11: pr.replace(/\s/g, "").toLowerCase(),
      amount_msat: amount_msat ? undefined : amount * 1000,
      maxfee: fee * 1000,
      retry_for: 30,
      layers: ["prefer-kappa"],
    });

    // Only log the xpay response when there's a real concern — no preimage
    // at all (xpay failed silently and we'll need to reverse) is interesting;
    // failed_parts WITH a preimage is normal multi-path retry behavior and
    // not worth warning about. The failed_parts branch below handles the
    // recovery without log spam in the success case.
    if (!(r?.payment_preimage ?? r?.preimage)) {
      warn("xpay returned no preimage", p.id, JSON.stringify({
        status: r?.status,
        failed_parts: r?.failed_parts,
        parts: r?.parts,
        amount_sent_msat: r?.amount_sent_msat,
        amount_msat: r?.amount_msat,
      }));
    }

    if (r.failed_parts) {
      // xpay didn't throw but reported failed parts. Verify with listpays
      // before deciding — for multi-path payments this is the common path
      // and usually finalizes cleanly; the noisy warns only fire when
      // listpays disagrees with xpay or finalize itself throws.
      try {
        const { pays } = await ln.listpays(pr);
        const completed = pays.find((x) => x.status === "complete");
        const failed = !pays.length || pays.every((x) => x.status === "failed");
        if (completed) {
          try { await finalize(completed, p); outcome = "finalized-via-listpays-after-failed_parts"; } catch (e: any) { warn("finalize threw in failed_parts branch", p.id, e?.message); outcome = "finalize-threw-failed_parts"; }
        } else if (failed) {
          warn("xpay failed_parts and listpays failed — reversing", p.id);
          await reverse(p); outcome = "reversed-via-failed_parts";
        } else {
          warn("xpay failed_parts, listpays still pending — leaving for check()", p.id);
          outcome = "pending-after-failed_parts";
        }
      } catch (verifyErr: any) {
        warnThrottled("listpays verification failed (failed_parts branch)", verifyErr?.message ?? String(verifyErr));
        outcome = "verify-failed-after-failed_parts";
      }
    } else {
      try {
        p = await finalize(r, p);
        outcome = "finalized";
      } catch (e: any) {
        warn("finalize threw despite no failed_parts", p.id, e?.message);
        outcome = "finalize-threw";
      }
    }
  } catch (e: any) {
    err("failed to pay", pr.substr(-8), "xpay error:", e?.message);
    try {
      const { pays } = await ln.listpays(pr);
      warn("listpays after xpay-threw", p.id, JSON.stringify(pays?.map((x) => ({ status: x.status, amount_sent_msat: x.amount_sent_msat })) ?? []));
      const completed = pays.find((p) => p.status === "complete");
      const failed = !pays.length || pays.every((p) => p.status === "failed");
      if (completed) {
        warn("payment completed despite error, finalizing", p.id);
        try { await finalize(completed, p); outcome = "finalized-after-xpay-throw"; } catch (_) { outcome = "finalize-threw-after-xpay-throw"; }
      } else if (failed) {
        await reverse(p); outcome = "reversed-after-xpay-throw";
      } else {
        outcome = "pending-after-xpay-throw";
      }
      // else: pending — leave the debit in place; check() loop will reconcile
      // once CLN confirms outcome. Reversing while still in flight would
      // refund the user even though the payment may yet complete.
    } catch (verifyErr: any) {
      // listpays itself errored (CLN unreachable). We deliberately don't
      // reverse here — the debit stays and pending stays in the reconciler
      // set, so check() will retry once CLN is back. Surface the failure so
      // a real outage doesn't go unnoticed.
      warnThrottled("listpays verification failed", verifyErr?.message ?? String(verifyErr));
      outcome = "verify-failed-after-xpay-throw";
    }
    warn("sendLightning outcome", p.id, "=", outcome);
    throw e;
  }

  // Leak guard: re-read the db record before deciding. If the payment has
  // ref set in db, it's settled regardless of which code path threw —
  // finalize() may have set ref via db.set and then thrown on a later line
  // (e.g. balance.incrBy for the fee refund), but the payment itself is
  // recorded as complete. Only treat as a real leak if ref is not in db.
  const finalizedOutcomes = new Set([
    "finalized",
    "finalized-via-listpays-after-failed_parts",
    "finalized-after-xpay-throw",
  ]);
  const safeNonFinalized = new Set([
    "reversed-via-failed_parts",
    "reversed-after-xpay-throw",
    "pending-after-failed_parts",
    "pending-after-xpay-throw",
    "verify-failed-after-failed_parts",
    "verify-failed-after-xpay-throw",
  ]);
  const persisted = await g(`payment:${p.id}`);
  const refInDb = !!persisted?.ref;
  if (refInDb || finalizedOutcomes.has(outcome)) {
    // Only log when the outcome wasn't the boring success case — every
    // payment goes through "finalized" so logging it is just noise. The
    // recovery-via-fallback variants (finalized-via-listpays-*, etc.) are
    // worth knowing about, so emit those.
    if (outcome !== "finalized") {
      l("sendLightning outcome", p.id, "=", outcome, refInDb && !finalizedOutcomes.has(outcome) ? "(ref set in db despite throw)" : "");
    }
  } else if (safeNonFinalized.has(outcome)) {
    warn("sendLightning outcome", p.id, "=", outcome);
  } else {
    err("LEAKED DEBIT in sendLightning", p.id, "outcome=", outcome, "user=", user?.username, "amount=", amount, "fee=", fee);
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
    } catch (e: any) {
      // Distinguish "lq is down" from "address isn't liquid" so users get a useful
      // message instead of "unrecognized address" when cs/lq is the actual problem.
      if (
        e?.message?.includes("Unable to connect") ||
        e?.code === "ECONNREFUSED" ||
        e?.code === "ETIMEDOUT"
      ) {
        fail("liquid temporarily unavailable");
      }
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


  return { feeRate, ourfee, fee, fees, hex: tx.hex, inputs, subtract };
};

export const catchUp = async () => {
  try {
    const txns = [];
    // Each chain is isolated: one being unreachable (e.g. lq when cs is down)
    // must not stop the other chain's deposit-recovery loop.
    for (const [type, n] of Object.entries({ bitcoin: bc, liquid: lq })) {
      try {
        txns.push(
          ...(await n.listTransactions("*", 100)).filter((tx) => {
            tx.type = type;
            return tx.category === "receive" && tx.confirmations > 0;
          }),
        );
      } catch (e: any) {
        warnThrottled(`catchUp ${type}`, e.message);
      }
    }

    for (const { txid, type } of txns) {
      try {
        if (await db.zScore("seen", txid)) continue;
        // walletnotify is the primary path; catchUp is a safety net. The
        // double-call I added 2026-05-05 was for when walletnotify was broken
        // on cs's lq — now that's fixed, a single call suffices and avoids
        // contributing to /confirm race conditions.
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
      // Skip payments sendLightning may still be actively driving. xpay retries
      // for 30s (retry_for: 30), during which listpays can momentarily show all
      // attempts "failed" before the winning part lands. The old 10s threshold
      // let check() reverse/refund such a payment mid-flight; it then completed,
      // and sendLightning's finalize threw on the deleted record — refunding a
      // payment that actually settled (the LEAKED DEBIT losses). Wait well past
      // the retry window so sendLightning has finished finalize()/reverse() and
      // removed it from `pending` before check() ever touches it.
      if (!p || Date.now() - p.created < 60000) continue;
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
  nwcNotify(p);

  const maxfee = p.fee;
  // Compute the actual fee xpay paid (sent − invoice amount, both msat).
  // Robust against zero-amount invoices (decoded amount_msat is undefined,
  // fall back to r.amount_msat) and against CLN occasionally returning
  // unexpected response shapes — if we can't compute a finite integer
  // fee, keep p.fee at the originally-reserved maxfee so the subsequent
  // refund delta is 0 instead of NaN (which would crash db.incrBy with
  // "value is not an integer or out of range" and leave finalize in a
  // partial state).
  const decoded = await ln.decode(p.hash);
  const invMsat = Number(decoded.amount_msat ?? r.amount_msat);
  const sentMsat = Number(r.amount_sent_msat);
  const computedFee = Math.round((sentMsat - invMsat) / 1000);
  if (!Number.isFinite(computedFee)) {
    warn("finalize: non-finite fee compute, keeping reserved maxfee", p.id,
         "sent_msat=", r.amount_sent_msat, "inv_msat=", decoded.amount_msat ?? r.amount_msat);
  }
  p.fee = Number.isFinite(computedFee) ? computedFee : maxfee;
  p.ref = preimage;

  const current = await g(`payment:${p.id}`);
  // The record is gone because a concurrent reverse() already refunded this
  // payment — yet here we are finalizing it, so it actually COMPLETED on the
  // network and the refund was wrong (coinos is now short the amount). Do NOT
  // silently re-create the record; raise a clear, greppable error so the
  // LEAKED DEBIT guard logs it for manual recovery instead of a cryptic
  // null-deref. (The check()-window fix should make this path very rare.)
  if (!current) fail(`finalize: payment ${p.id} reversed-then-completed (double-pay leak)`);

  if (!current.ref) {
    await s(`payment:${p.id}`, p);
    const refund = maxfee - p.fee;
    if (Number.isFinite(refund) && Number.isInteger(refund)) {
      await db.incrBy(`balance:${p.uid}`, refund);
    } else {
      warn("finalize: skipping fee refund (non-integer delta)", p.id,
           "maxfee=", maxfee, "p.fee=", p.fee, "refund=", refund);
    }
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
    // Only spendable channels — ONCHAIN/CLOSING funds are locked in pending
    // sweeps and aren't usable for lightning sends, so counting them inflates
    // the limit. CHANNELD_AWAITING_SPLICE is included so an in-flight splice
    // doesn't briefly drop the limit to zero.
    lnbalance = Math.round(
      funds.channels
        .filter((c) =>
          c.state === "CHANNELD_NORMAL" || c.state === "CHANNELD_AWAITING_SPLICE",
        )
        .reduce((a, b) => a + b.our_amount_msat, 0) / 1000,
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
