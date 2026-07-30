import config from "$config";
import { db, g, s } from "$lib/db";
import { request } from "$lib/ecash";
import ln from "$lib/ln";
import { warn } from "$lib/logging";
import { emit } from "$lib/sockets";
import { SATS, bip21, fail, getInvoice, getUser } from "$lib/utils";
import rpc from "@coinos/rpc";
import { v4 } from "uuid";

import { PaymentType } from "$lib/types";

const bc = rpc(config.bitcoin);
const lq = rpc(config.liquid);

// Preimage queue entries are {preimage, price, fiat, currency} JSON, but
// entries queued before prices existed are bare hex strings — treat those
// as priceless
export const parseEntry = (e) => {
  try {
    const parsed = JSON.parse(e);
    if (parsed?.preimage)
      return { price: null, fiat: null, currency: null, ...parsed };
  } catch {}
  return { preimage: e, price: null, fiat: null, currency: null };
};

export const generate = async ({ invoice, user }) => {
  let {
    address_type,
    bolt11,
    bolt12,
    aid,
    currency,
    expiry,
    fiat,
    id,
    tip,
    amount,
    items = [],
    own,
    rate,
    request_id,
    memo,
    memoPrompt,
    prompt,
    type = PaymentType.lightning,
    usePreimage,
    webhook,
    secret,
  } = invoice;

  amount = Number.parseInt(amount || 0);
  tip = tip == null ? null : Number.parseInt(tip);

  if (user) user = await getUser(user.username);
  if (!user) fail("user not provided");
  if (typeof prompt === "undefined") prompt = user.prompt;

  let account = await g(`account:${aid}`);
  if (!account) account = await g(`account:${user.id}`);
  if (!account) fail("account not found");
  aid = account.id;

  const rates = await g("rates");
  if (!currency) currency = user.currency;
  if (!rate) rate = rates[currency];
  if (fiat) amount = Math.round((SATS * fiat) / rate);
  if (amount < 0) fail("invalid amount");
  // On-chain deposits below 300 sats are silently dropped by the dust filter in
  // the /confirm credit path (routes/payments.ts), so reject creating a bitcoin/
  // liquid invoice for a specific sub-300-sat amount rather than letting a
  // deposit vanish. amount = 0 (any-amount address) is unaffected.
  if (
    (type === PaymentType.bitcoin || type === PaymentType.liquid) &&
    amount > 0 &&
    amount < 300
  )
    fail(
      "On-chain deposits must be at least 300 sats. Use a Lightning invoice for smaller amounts.",
    );
  if (tip < 0) fail("invalid tip");
  if (rate < 0) fail("invalid rate");
  if (memo && memo.length > 5000) fail("memo too long");

  if (!id) id = v4();

  let hash;
  let text;
  let paymentHash;

  if (type === PaymentType.lightning) {
    let r;
    if (bolt11) {
      const { id: nodeid } = await ln.getinfo();
      r = await ln.decode(bolt11);
      if (r.payee !== nodeid) fail("invalid invoice");
      amount = Math.round(r.amount_msat / 1000);
      r.bolt11 = bolt11;
    } else {
      expiry ||= 60 * 60 * 24 * 30;

      const args = {
        label: `${id} ${user.username} ${Date.now()}`,
        description: memo || "",
        expiry,
        deschashonly: true,
        cltv: 19,
      };

      if (usePreimage) {
        // Consume the merchant's pre-loaded preimages (FIFO) so the invoice's
        // payment hash is sha256(preimage) and paying it reveals a secret the
        // merchant chose. Never fall back to a random preimage — a buyer would
        // be paying for a secret that unlocks nothing.
        const queue = `${user.id}:preimages`;
        let entry;
        while ((entry = await db.lPop(queue))) {
          const {
            preimage,
            price,
            fiat: entryFiat,
            currency: entryCurrency,
          } = parseEntry(entry);
          // The invoice creator is unauthenticated, so a merchant-set price
          // must win over the amount in the request — otherwise a buyer
          // could name their own price for the secret. Fiat prices convert
          // at the current rate, and the invoice takes on the merchant's
          // currency so receipts show the fiat price as set.
          if (price) amount = price;
          else if (entryFiat) {
            if (!rates[entryCurrency]) {
              await db.lPush(queue, entry);
              fail(`no rate available for ${entryCurrency}`);
            }
            currency = entryCurrency;
            rate = rates[currency];
            amount = Math.round((SATS * entryFiat) / rate);
          }
          try {
            r = await ln.invoice({
              ...args,
              amount_msat: amount ? `${amount + tip}sat` : "any",
              preimage,
            });
            // Keep the preimage recoverable for internal settlements, where
            // cln never pays the invoice and so never reveals it — credit()
            // picks this up as the payment ref
            await db.set(`preimage:${r.payment_hash}`, preimage, {
              EX: expiry,
            });
            break;
          } catch (e) {
            // cln rejects a preimage whose payment hash it has already seen —
            // that one is permanently unusable, so drop it and try the next
            if (/preimage/i.test(e.message)) {
              warn("discarding unusable preimage", user.username, e.message);
              continue;
            }
            await db.lPush(queue, entry);
            throw e;
          }
        }
        if (!r) fail("no preimages available");
      } else {
        r = await ln.invoice({
          ...args,
          amount_msat: amount ? `${amount + tip}sat` : "any",
        });
      }
    }

    hash = r.bolt11;
    text = r.bolt11;
    paymentHash = r.payment_hash;
  } else if (type === PaymentType.bolt12) {
    let r;
    if (bolt12) {
      const { id: nodeid } = await ln.getinfo();
      r = await ln.decode(bolt12);
      if (r.invoice_node_id !== nodeid) fail("invalid invoice");
      amount = Math.round(r.invoice_amount_msat / 1000);
      r.bolt12 = bolt12;
    } else {
      r = await ln.offer({
        amount: amount ? `${amount + tip}sat` : "any",
        label: `${id} ${user.username} ${new Date()}`,
        description: memo || id,
      });

      // CLN returns the same offer_id for identical offer contents, so a
      // re-create of an offer we already track must not register a second
      // invoice for it (duplicate :invoices entries — see kaliyi's OCEAN
      // offer). If it's the same user's offer, hand back the existing record.
      const existing = await getInvoice(r.offer_id);
      if (existing) {
        if (existing.uid === user.id) return existing;
        fail("Duplicate offer exists");
      }
      await s(`invoice:${r.offer_id}`, id);
    }

    hash = r.bolt12;
    text = r.bolt12;
  } else if (type === PaymentType.bitcoin) {
    address_type ||= "bech32";
    hash = await bc.getNewAddress({ address_type });
    text = bip21(hash, invoice);
  } else if (type === PaymentType.liquid) {
    address_type ||= "blech32";
    hash = await lq.getNewAddress({ address_type });
    text = bip21(hash, invoice);
  } else if (type === PaymentType.internal) {
    hash = id;
  } else if (type === PaymentType.ecash) {
    hash = id;
    text = request(id, amount, memo);
  } else {
    fail(`unrecognized type ${type}`);
  }

  invoice = {
    amount,
    aid,
    address_type,
    created: Date.now(),
    currency,
    hash,
    expiry,
    id,
    items,
    memo,
    rate,
    paymentHash,
    pending: 0,
    received: 0,
    request_id,
    memoPrompt,
    own,
    prompt,
    secret,
    text,
    tip,
    type,
    uid: user.id,
    webhook,
  };

  if (type === "liquid") {
    const { unconfidential } = await lq.getAddressInfo(hash);
    await s(`invoice:${unconfidential}`, id);
  }

  await s(`invoice:${hash}`, id);
  await s(`invoice:${id}`, invoice);
  // generate() is also called on UPDATE (re-using an existing invoice id, e.g.
  // a tip/webhook change or a repeated bolt12 offer create), which must NOT
  // re-append the id to the list. Only add it the first time — otherwise the
  // user's :invoices accumulates duplicate entries and the same offer/invoice
  // renders multiple times (see kaliyi's OCEAN offer, listed 2-6x).
  if ((await db.lPos(`${aid}:invoices`, id)) === null)
    await db.lPush(`${aid}:invoices`, id);

  if (request_id) {
    const request = await g(`request:${request_id}`);
    if (request) {
      const { invoice_id: prev } = request;
      request.invoice_id = id;
      await s(`request:${request_id}`, request);

      if (!prev) emit(request.requester_id, "invoice", invoice);
    }
  }

  return invoice;
};

// Each user gets one standing amountless bolt12 offer (lno1...) they can hand
// out as a reusable payment code — e.g. published in a kind 10058 list for
// NIP-177 bolt12 zaps. Created lazily on first request, then reused; incoming
// payments credit through the regular bolt12 receive path via local_offer_id.
export const getUserOffer = async (user) => {
  const key = `${user.id}:offer`;
  const existingId = await g(key);
  if (existingId) {
    const existing = await g(`invoice:${existingId}`);
    if (existing?.hash) return existing;
  }

  let domain;
  try {
    domain = new globalThis.URL(process.env.URL).host;
  } catch (e) {}

  const invoice = await generate({
    invoice: {
      type: PaymentType.bolt12,
      memo: domain ? `${user.username}@${domain}` : user.username,
    },
    user,
  });

  await s(key, invoice.id);
  return invoice;
};
