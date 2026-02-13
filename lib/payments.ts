import config from "$config";
import api from "$lib/api";
import { db, g, ga, gf, s } from "$lib/db";
import {
  broadcastTx,
  btcNetwork,
  deriveAddress,
  deriveAddresses,
  getAddressTxs,
  getAddressUtxos,
  getTxHex,
  getTxStatus,
  hdVersions,
  findLastUsedIndex,
} from "$lib/esplora";
import { HDKey } from "@scure/bip32";
import { generate } from "$lib/invoices";
import ln from "$lib/ln";
import { err, l, warn } from "$lib/logging";
import { handleZap } from "$lib/nostr";
import { notify, nwcNotify } from "$lib/notifications";
import { emit } from "$lib/sockets";
import { squarePayment } from "$lib/square";
import {
  getBalance,
  getCredit,
  tbConfirm,
  tbCredit,
  tbDebit,
  tbRefund,
  tbReverse,
  tbSetBalance,
  tbSetPending,
} from "$lib/tb";
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
import { sendArk } from "$lib/ark";
import { callWebhook } from "$lib/webhooks";
import rpc from "@coinos/rpc";
import { selectUTXO, p2wpkh } from "@scure/btc-signer";
import { bech32 } from "bech32";
import got from "got";
import { v4 } from "uuid";

import { PaymentType } from "$lib/types";

const bc = rpc(config.bitcoin);
const lq = rpc(config.liquid);
const { URL } = process.env;

const dust = 547;

export const getUserRate = async (user) => {
  const rates = await g("rates");
  const { currency } = user;
  const rate = rates[currency];
  return { rates, rate, currency };
};

export const acquireArkLock = async (hash) => {
  const locked = await db.set(`arklock:${hash}`, "1", { NX: true, EX: 60 });
  if (!locked) fail("Already processed");
};

export const createArkPayment = async ({
  aid,
  uid,
  amount,
  hash,
  rate,
  currency,
  type = PaymentType.ark,
  iid = undefined,
  created = Date.now(),
  mapHashToId = false,
  extraHashMappings = [] as string[],
  extraMultiOps = undefined as ((m: any, p: any) => void) | undefined,
}) => {
  const p = {
    id: v4(),
    aid,
    amount,
    hash,
    confirmed: true,
    rate,
    currency,
    type,
    uid,
    iid,
    created,
  };

  const m = db.multi();
  m.set(`payment:${p.id}`, JSON.stringify(p))
    .lPush(`${aid}:payments`, p.id)
    .set(`${aid}:payments:last`, p.created);

  if (mapHashToId) {
    m.set(`payment:${aid}:${hash}`, JSON.stringify(p.id));
  }

  for (const h of extraHashMappings) {
    m.set(`payment:${aid}:${h}`, JSON.stringify(p.id));
  }

  if (extraMultiOps) extraMultiOps(m, p);

  await m.exec();

  return p;
};

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

  const serverLimit = await g(`${type}:limit`);
  const userLimit = await g("limit");
  const frozen =
    (await g("hardfreeze")) ||
    ((await g("freeze")) && type !== PaymentType.internal);

  if (frozen || (amount > userLimit && !whitelisted) || amount > serverLimit) {
    warn(
      "Blocking",
      user.username,
      amount,
      hash,
      user.id,
      type,
      frozen,
      userLimit,
      serverLimit,
    );
    fail("Problem sending payment");
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
    !blacklisted || whitelisted ? 0 : await getBalance(uid);

  ourfee = await tbDebit(
    aid,
    uid,
    creditType,
    amount || 0,
    tip || 0,
    fee || 0,
    ourfee || 0,
    frozenBalance || 0,
    t(user).insufficientFunds,
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
    created: Date.now(),
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
  } else {
    await s(`payment:${hash}`, id);
  }

  let creditType = type;
  if (creditType === PaymentType.bolt12) creditType = PaymentType.lightning;
  const isPending = balanceKey === "pending";

  await tbCredit(aid || uid, uid, creditType, amount, isPending);

  await db
    .multi()
    .set(`invoice:${inv.id}`, JSON.stringify(inv))
    .set(`payment:${p.id}`, JSON.stringify(p))
    .lPush(`${aid || uid}:payments`, p.id)
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
    if (inv.forward && !inv.forwarded) {
      const lockKey = `forward:${inv.id}`;
      const locked = await db.setNX(lockKey, "1");
      if (locked) {
        await db.expire(lockKey, 300);
        try {
          inv.forwarded = true;
          await s(`invoice:${inv.id}`, inv);

          // Skip forward if destination is the same user's own Lightning invoice
          if (inv.forward.startsWith("ln")) {
            const destInv = await getInvoice(inv.forward).catch(() => null);
            if (destInv?.uid === id) return;
          }

          await pay({ amount: p.amount, to: inv.forward, user });
        } catch (e) {
          warn(username, "forward failed", inv.forward, e.message);
        }
      }
    } else if (autowithdraw && p.type !== "ark") {
      try {
        const to = destination.trim();
        const balance = await getBalance(id);
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

  nwcNotify(p);
  notify(p, user, withdrawal);

  squarePayment(p, user);

  l(username, "received", p.type, p.amount);
  callWebhook(inv, p);
};

const confirmWatchedIncoming = async (address, existing) => {
  existing.confirmed = true;
  const inv = await getInvoice(address);
  if (inv) {
    inv.received += Number.parseInt(inv.pending);
    inv.pending = 0;
    await s(`invoice:${inv.id}`, inv);
  }
  await s(`payment:${existing.id}`, existing);
  await tbConfirm(existing.aid || existing.uid, existing.amount);
  const user = await getUser(existing.uid);
  if (inv) await completePayment(inv, existing, user);
  await db.sRem("watching", address);
};

export const processWatchedTx = async (tx) => {
  const txid = tx.txid;

  for (let vout = 0; vout < tx.vout.length; vout++) {
    const output = tx.vout[vout];
    const address = output.scriptpubkey_address;
    if (!address) continue;
    if (!(await db.sIsMember("watching", address))) continue;

    const invoice = await getInvoice(address);
    if (!invoice) continue;

    const existing = await getPayment(`${txid}:${vout}`);
    if (existing) {
      if (!existing.confirmed && tx.status?.confirmed) {
        await confirmWatchedIncoming(address, existing);
      }
      continue;
    }

    if (output.value < 300) continue;

    const lockKey = `lock:${txid}:${vout}`;
    const locked = await db.setNX(lockKey, "1");
    if (!locked) continue;
    await db.expire(lockKey, 60);

    await credit({
      hash: address,
      amount: output.value,
      ref: `${txid}:${vout}`,
      type: PaymentType.bitcoin,
      aid: invoice.aid,
    });

    if (tx.status?.confirmed) {
      const created = await getPayment(`${txid}:${vout}`);
      if (created && !created.confirmed) {
        await confirmWatchedIncoming(address, created);
      }
    }
  }
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

  if (to.startsWith("ark") || to.startsWith("tark")) {
    const fee = Math.max(5, Math.round(amount * 0.02));
    amount -= fee;
    const txid = await sendArk(to, amount);
    return debit({
      hash: txid,
      amount: amount + fee,
      fee,
      user,
      type: PaymentType.ark,
    });
  }

  let fee;
  const ourfee = Math.round(amount * (config.fee.lightning || 0));
  if (lnurl) {
    fee = Math.max(5, Math.round(amount * 0.02));
    amount -= fee + ourfee;
    const { callback } = (await got(lnurl).json()) as any;
    ({ pr } = (await got(`${callback}?amount=${amount * 1000}`).json()) as any);
  } else if (to.startsWith("lno")) {
    const { id: source } = await ln.getinfo();
    const { offer_issuer_id } = await ln.decode(to);
    const { routes } = await ln.getroutes(
      source, offer_issuer_id, amount * 1000,
      ["auto.localchans", "auto.sourcefree"],
      Math.round(amount * 0.02) * 1000, 6,
    );
    fee = routes.length
      ? Math.max(5, Math.round((routes[0].path[0].amount_msat - routes[0].amount_msat) / 1000))
      : 0;
    amount -= fee + ourfee;
    const { invoice } = await ln.fetchinvoice(to, amount * 1000);
    pr = invoice;
  } else if (to.startsWith("ln")) {
    fee = Math.max(5, Math.round(amount * 0.02));
    amount -= fee + ourfee;
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

const sendNonCustodial = async (params) => {
  let { aid, hex, rate, user } = params;
  if (!hex) ({ hex } = await build(params));

  const { tx } = await decode(hex);
  let { txid } = tx;

  try {
    if (inflight[txid]) fail("payment in flight");
    inflight[txid] = true;

    const account = await g(`account:${aid}`);
    const nextIndex = account.nextIndex || 0;

    // Build set of own addresses for change detection
    const ownAddresses = new Set<string>();
    for (let i = 0; i <= nextIndex; i++) {
      ownAddresses.add(
        deriveAddress(account.pubkey, account.fingerprint, i, false).address,
      );
      ownAddresses.add(
        deriveAddress(account.pubkey, account.fingerprint, i, true).address,
      );
    }

    let totalIn = 0;
    for (const { txid: inputTxid, vout } of tx.vin) {
      const inputHex = await getTxHex(inputTxid);
      const inputTx = await bc.decodeRawTransaction(inputHex);
      totalIn += sats(inputTx.vout[vout].value);
    }

    let total = 0;
    let change = 0;
    for (const {
      scriptPubKey: { address },
      value,
    } of tx.vout) {
      total += sats(value);
      const invoice = await getInvoice(address);
      if (invoice?.aid === aid) fail("Cannot send to internal address");

      if (ownAddresses.has(address)) {
        change += sats(value);
      }
    }

    const fee = totalIn - total;
    const amount = total - change;

    const p = await debit({
      aid,
      hash: txid,
      amount,
      fee,
      rate,
      user,
      type: PaymentType.bitcoin,
    });

    p.hex = hex;
    await s(`payment:${p.id}`, p);

    await broadcastTx(hex);
    await db.sAdd(`inflight:${aid}`, p.id);

    delete inflight[txid];
    return p;
  } catch (e) {
    delete inflight[txid];
    throw e;
  }
};

export const sendOnchain = async (params) => {
  let { aid, hex, rate, user, signed } = params;
  if (!aid) aid = user.id;

  // Non-custodial bitcoin account — use esplora
  if (aid !== user.id) {
    return sendNonCustodial(params);
  }

  if (!hex) ({ hex } = await build(params));

  const { tx, type } = await decode(hex);
  const node = rpc(config[type]);
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
      retry_for: 20,
      extratlvs,
    });
  } catch (e) {
    reverse(p);
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

  const { channels } = await ln.listpeerchannels();
  const isDirect = channels.some((c) => c.peer_id === payee);
  const minfee = isDirect ? 0 : Math.max(Math.round(amount * 0.005), 5);

  fee = Math.max(Number.parseInt(fee || 0), minfee);
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
      retry_for: 20,
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

const buildNonCustodial = async ({
  aid,
  amount,
  address,
  feeRate,
  subtract,
  user,
}) => {
  const account = await g(`account:${aid}`);
  if (!account?.pubkey) fail("account missing pubkey");

  amount = Number.parseInt(amount);
  if (amount < 0) fail("invalid amount");

  const fees: any = await fetch(
    `${api[PaymentType.bitcoin]}/fees/recommended`,
  ).then((r) => r.json());

  fees.hourFee = fees.halfHourFee;
  fees.halfHourFee = fees.fastestFee;
  fees.fastestFee = Math.ceil(fees.fastestFee * 1.5);

  if (!feeRate) feeRate = fees.halfHourFee;
  if (feeRate < fees.hourFee) fail("fee rate too low");

  const nextIndex = account.nextIndex || 0;

  // Derive all used external + internal addresses and fetch UTXOs
  const externalAddrs = deriveAddresses(
    account.pubkey,
    account.fingerprint,
    nextIndex + 1,
    false,
  );
  const internalAddrs = deriveAddresses(
    account.pubkey,
    account.fingerprint,
    nextIndex + 1,
    true,
  );
  const allAddrs = [...externalAddrs, ...internalAddrs];

  const rawUtxos = await getAddressUtxos(allAddrs);
  if (!rawUtxos.length) fail("no UTXOs available");

  // Build address-to-path lookup
  const addrToPath = {};
  for (let i = 0; i <= nextIndex; i++) {
    const { address: extAddr } = deriveAddress(
      account.pubkey,
      account.fingerprint,
      i,
      false,
    );
    addrToPath[extAddr] = `m/0/${i}`;
    const { address: intAddr } = deriveAddress(
      account.pubkey,
      account.fingerprint,
      i,
      true,
    );
    addrToPath[intAddr] = `m/1/${i}`;
  }

  // Convert esplora UTXOs to selectUTXO input format
  const keyVersions = account.pubkey.startsWith("tpub")
    ? hdVersions
    : undefined;
  const accountKey = HDKey.fromExtendedKey(account.pubkey, keyVersions);

  const utxoInputs = rawUtxos.map((u) => {
    const path = addrToPath[u.address];
    const parts = path.split("/").slice(-2);
    const child = accountKey
      .deriveChild(Number.parseInt(parts[0]))
      .deriveChild(Number.parseInt(parts[1]));
    const payment = p2wpkh(child.publicKey, btcNetwork);

    return {
      txid: u.txid,
      index: u.vout,
      witnessUtxo: {
        amount: BigInt(u.value),
        script: payment.script,
      },
    };
  });

  const balance = await getBalance(aid);
  let ourfee = 0; // Non-custodial accounts don't pay platform fee

  const outputs = [{ address, amount: BigInt(amount) }];

  // Derive a change address (next internal address)
  const { address: changeAddress } = deriveAddress(
    account.pubkey,
    account.fingerprint,
    nextIndex,
    true,
  );

  let selected = selectUTXO(utxoInputs, outputs, "default", {
    changeAddress,
    feePerByte: BigInt(feeRate),
    network: btcNetwork,
    createTx: true,
  });

  if (!selected) {
    subtract = true;
    if (amount <= dust) {
      fail(`insufficient funds ⚡️${balance} of ⚡️${amount + dust}`);
    }

    // Try with subtracted fee — send max
    const maxOutputs = [{ address, amount: BigInt(amount) }];
    selected = selectUTXO(utxoInputs, maxOutputs, "all", {
      changeAddress,
      feePerByte: BigInt(feeRate),
      network: btcNetwork,
      createTx: true,
    });

    if (!selected) fail("insufficient funds");
  }

  const fee = Number(selected.fee);

  // Build input metadata for client signing
  const inputs = selected.inputs.map((input) => {
    const inputTxid =
      typeof input.txid === "string"
        ? input.txid
        : Buffer.from(input.txid).toString("hex");
    const utxo = rawUtxos.find(
      (u) => u.txid === inputTxid && u.vout === input.index,
    );
    const path = utxo ? addrToPath[utxo.address] : undefined;
    return {
      witnessUtxo: {
        amount: Number(input.witnessUtxo.amount),
        script: Buffer.from(input.witnessUtxo.script).toString("hex"),
      },
      path,
    };
  });

  const hex = Buffer.from(selected.tx.toPSBT()).toString("hex");

  return { feeRate, ourfee, fee, fees, hex, inputs, subtract };
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

  // Non-custodial bitcoin account — use esplora
  if (aid !== user.id && type === PaymentType.bitcoin) {
    const account = await g(`account:${aid}`);
    if (account?.pubkey) {
      return buildNonCustodial({ aid, amount, address, feeRate, subtract, user });
    }
  }

  const node = rpc(config[type]);

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

  const balance = await getBalance(aid);
  let ourfee = Math.round(amount * config.fee[type]);
  const creditBal = await getCredit(aid, type);
  const covered = Math.min(creditBal, ourfee);
  ourfee -= covered;

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
    // Check watched addresses for any missed bitcoin transactions
    const watched = await db.sMembers("watching");
    for (const address of watched) {
      try {
        const txs = await getAddressTxs(address);
        for (const tx of txs) {
          await processWatchedTx(tx);
        }
      } catch (e) {
        err("catchUp address check failed", address, e.message);
      }
    }

    // Non-custodial accounts: check pending outgoing payments
    const inflightAccounts = await db.keys("inflight:*");
    for (const key of inflightAccounts) {
      const aid = key.replace("inflight:", "");
      const keyType = await db.type(key);
      if (keyType !== "set") continue;
      const paymentIds = await db.sMembers(key);
      for (const pid of paymentIds) {
        try {
          const p = await gf(`payment:${pid}`);
          if (!p || p.confirmed) {
            await db.sRem(key, pid);
            continue;
          }
          const status = await getTxStatus(p.hash);
          if (status.confirmed) {
            p.confirmed = true;
            await s(`payment:${p.id}`, p);
            await db.sRem(key, pid);
            emit(p.uid, "payment", p);
          }
        } catch (e) {
          err("problem checking inflight payment", e.message);
        }
      }
    }
  } catch (e) {
    err("problem catching up", e.message);
  }
};

export const importAccountHistory = async (account) => {
  try {
    const { id, uid, pubkey, fingerprint } = account;
    const user = await getUser(uid);

    let nextIndex = account.nextIndex || 0;
    if (!account.importedAt) {
      const lastUsed = await findLastUsedIndex(pubkey, fingerprint);
      if (lastUsed > nextIndex) nextIndex = lastUsed;
      account.nextIndex = nextIndex;
    }

    const count = nextIndex + 1;
    const externalAddrs = deriveAddresses(pubkey, fingerprint, count, false);
    const internalAddrs = deriveAddresses(pubkey, fingerprint, count, true);
    const allAddrs = [...externalAddrs, ...internalAddrs];
    const addressSet = new Set(allAddrs);

    const utxos = await getAddressUtxos(allAddrs);
    const confirmedUtxos = utxos.filter(
      (u) => u.status.confirmed && u.value >= 300,
    );
    const total = confirmedUtxos.reduce((sum, u) => sum + u.value, 0);

    const rates = await g("rates");
    let rate = rates[user.currency];
    if (!rate) await sleep(1000);
    rate = rate || rates[user.currency];

    for (const u of confirmedUtxos) {
      const existing = await getPayment(`${u.txid}:${u.vout}`);
      if (existing?.aid === id) continue;

      if (existing) {
        existing.aid = id;
        await db
          .multi()
          .set(`payment:${existing.id}`, JSON.stringify(existing))
          .lPush(`${id}:payments`, existing.id)
          .exec();
        continue;
      }

      const created = u.status?.block_time
        ? u.status.block_time * 1000
        : Date.now();
      const p = {
        id: v4(),
        aid: id,
        amount: u.value,
        fee: 0,
        hash: u.address,
        confirmed: true,
        rate,
        currency: user.currency,
        type: PaymentType.bitcoin,
        uid,
        ref: `${u.txid}:${u.vout}`,
        created,
      };

      await db
        .multi()
        .set(`payment:${u.txid}:${u.vout}`, p.id)
        .set(`payment:${p.id}`, JSON.stringify(p))
        .lPush(`${id}:payments`, p.id)
        .set(`${id}:payments:last`, p.created)
        .exec();
    }

    const txsById = new Map();
    for (const address of allAddrs) {
      const txs = await getAddressTxs(address);
      for (const tx of txs) {
        txsById.set(tx.txid, tx);
      }
    }

    for (const tx of txsById.values()) {
      if (!tx.status?.confirmed) continue;
      const existing = await getPayment(tx.txid);
      if (existing?.aid === id) continue;
      if (existing) {
        existing.aid = id;
        await db
          .multi()
          .set(`payment:${existing.id}`, JSON.stringify(existing))
          .lPush(`${id}:payments`, existing.id)
          .exec();
        continue;
      }

      let inputsFromUs = 0;
      let outputsToUs = 0;
      let totalIn = 0;
      let totalOut = 0;

      for (const vin of tx.vin || []) {
        const prev = vin.prevout;
        if (!prev) continue;
        const value = Number.parseInt(prev.value) || 0;
        totalIn += value;
        if (addressSet.has(prev.scriptpubkey_address)) inputsFromUs += value;
      }

      for (const vout of tx.vout || []) {
        const value = Number.parseInt(vout.value) || 0;
        totalOut += value;
        if (addressSet.has(vout.scriptpubkey_address)) outputsToUs += value;
      }

      if (!inputsFromUs) continue;

      const net = outputsToUs - inputsFromUs;
      if (net >= 0) continue;

      const amount = totalOut - outputsToUs;
      if (amount <= 0) continue;

      const fee = Math.max(0, totalIn - totalOut);
      const created = tx.status?.block_time
        ? tx.status.block_time * 1000
        : Date.now();

      const p = {
        id: v4(),
        aid: id,
        amount: -amount,
        fee,
        hash: tx.txid,
        confirmed: true,
        rate,
        currency: user.currency,
        type: PaymentType.bitcoin,
        uid,
        created,
      };

      await db
        .multi()
        .set(`payment:${tx.txid}`, p.id)
        .set(`payment:${p.id}`, JSON.stringify(p))
        .lPush(`${id}:payments`, p.id)
        .set(`${id}:payments:last`, p.created)
        .exec();
    }

    await tbSetBalance(id, total);
    await tbSetPending(id, 0);

    account.importedAt = account.importedAt || Date.now();
    await s(`account:${id}`, account);
  } catch (e) {
    console.log(e);
    warn("problem importing account history", e.message, account);
  }
};


export const check = async () => {
  if (process.env.URL.includes("dev")) return;
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
        if (e.message?.includes("already been reversed")) {
          await db.sRem("pending", p.hash);
        }
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
  nwcNotify(p);

  const maxfee = p.fee;
  const { amount_msat, invoice_amount_msat } = await ln.decode(p.hash);
  p.fee = Math.round((r.amount_sent_msat - (amount_msat || invoice_amount_msat)) / 1000);
  p.ref = preimage;

  if (!(await g(`payment:${p.id}`)).ref) {
    await s(`payment:${p.id}`, p);

    l("refunding fee", maxfee, p.fee, maxfee - p.fee, p.ref);
    await tbRefund(p.uid, maxfee - p.fee);
  }

  return p;
};

const reverse = async (p) => {
  await sleep(Math.floor(Math.random() * (1500 - 500 + 1)) + 500);

  const total = Math.abs(p.amount) + p.fee + p.ourfee;
  const ourfee = p.ourfee || 0;
  const credit = Math.round(total * config.fee[PaymentType.lightning]) - ourfee;

  l("reversing", p.id, p.amount, p.fee, total, ourfee, credit);

  // Check payment still exists before reversing
  const exists = await db.exists(`payment:${p.id}`);
  if (!exists) throw new Error("Payment has already been reversed");

  // TB: restore balance + credits
  await tbReverse(p.uid, total, credit);

  // Redis: clean up payment records
  await db
    .multi()
    .del(`payment:${p.id}`)
    .sRem("pending", p.hash)
    .del(`payment:${p.hash}`)
    .lRem(`${p.uid}:payments`, 0, p.id)
    .lRem("payments", 0, p.id)
    .exec();

  warn("reversed", p.id);
};

const freezeCheck = async () => {
  const funds = await ln.listfunds();
  const lnbalance = Math.round(
    funds.channels.reduce((a, b) => a + b.our_amount_msat, 0) / 1000,
  );

  const bcbalance = Math.round((await bc.getBalance()) * SATS);
  const { bitcoin } = await lq.getBalance();
  const lqbalance = Math.round(bitcoin * SATS);

  const lnthreshold = await g("lightning:threshold");
  const bcthreshold = await g("bitcoin:threshold");
  const lqthreshold = await g("liquid:threshold");

  await s("lightning:limit", Math.max(lnbalance - lnthreshold, 0));
  await s("bitcoin:limit", Math.max(bcbalance - bcthreshold, 0));
  await s("liquid:limit", Math.max(lqbalance - lqthreshold, 0));

  await s("fund:limit", Math.max(lnbalance - lnthreshold, 0));
  await s("ecash:limit", Math.max(lnbalance - lnthreshold, 0));
  await s("bolt12:limit", Math.max(lnbalance - lnthreshold, 0));

  setTimeout(freezeCheck, 10000);
};
freezeCheck();
