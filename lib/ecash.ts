import config from "$config";
import { g } from "$lib/db";
import { generate } from "$lib/invoices";
import { warn } from "$lib/logging";
import { PaymentType } from "$lib/types";
import { fail, getPayment, sleep, wait } from "$lib/utils";
import {
  CashuMint,
  CashuWallet,
  PaymentRequest,
  PaymentRequestTransportType,
  getDecodedToken,
} from "@cashu/cashu-ts";

const { URL } = process.env;
const m = new CashuMint(config.mintUrl);

// Redeeming ecash is a plain NUT-05 melt: the proofs pay a Lightning invoice
// that belongs to the redeeming user, and the settlement is credited by the
// regular lightning listener like any other incoming payment. The mint's node
// is our own, so the melt is a self-payment on cl — nothing is held in a house
// wallet and no proofs are swapped or stored on our side.

// cashu-ts 2.9.0 writes v1 keyset ids into V4 tokens in their 8-byte short form
// and refuses to decode a short id unless it's handed the mint's keysets to
// expand it against. config.mintUrl fronts every keyset we've ever issued, so
// its list is enough to decode any token of ours.
const KEYSETS_TTL = 10 * 60 * 1000;
let cached: { keysets: any[]; at: number } | undefined;
const keysets = async () => {
  if (cached && Date.now() - cached.at < KEYSETS_TTL) return cached.keysets;
  const { keysets } = await m.getKeySets();
  // Never cache an empty list: a token can't be decoded or fee-checked
  // against it, and the next call should try the mint again.
  if (!keysets?.length) fail("Mint keysets unavailable");
  cached = { keysets, at: Date.now() };
  return keysets;
};

// A short keyset id that doesn't expand against our keysets belongs to some
// other mint; say so instead of surfacing cashu-ts's mapping error.
const decode = async (token) => {
  try {
    return getDecodedToken(token, await keysets());
  } catch (e) {
    if (/short keyset id/i.test(e.message))
      fail("Unable to receive from other mints");
    throw e;
  }
};

// A token is ours when every proof is on one of our keysets. Keyset ids are
// derived from the mint's public keys, so they identify the issuer; the token's
// `mint` URL is just a label the sending wallet wrote in (tokens of ours turn
// up with stray ports and paths on it) and is never fetched. A miss refreshes
// the cached list once in case a keyset was rotated in since it was fetched.
const ext = async (proofs) => {
  const ours = (ks) => {
    const ids = new Set(ks.map((k) => k.id));
    return proofs.every((p) => ids.has(p.id));
  };
  if (ours(await keysets())) return false;
  cached = undefined;
  return !ours(await keysets());
};

const sum = (proofs) => proofs.reduce((a, p) => a + p.amount, 0);

// NUT-02 input fee: ceil of the summed per-proof ppk.
const inputFee = (proofs, ks) =>
  Math.ceil(
    proofs.reduce(
      (a, p) => a + (ks.find((k) => k.id === p.id)?.input_fee_ppk || 0),
      0,
    ) / 1000,
  );

// nutshell's Lightning fee reserve: max(lightning_reserve_fee_min = 2 sat,
// lightning_fee_percent = 1%), rounded up to whole sats. The actual routing fee
// of a self-payment is zero, but without NUT-08 change outputs the mint keeps
// the reserve — it's our mint, so nothing leaves the system.
const reserve = (amount) => Math.max(2, Math.ceil(amount / 100));

export async function get(id) {
  const token = await g(`cash:${id}`);
  return token;
}

// Melt `token` into a Lightning invoice owned by `user`. With `invoice` (a
// NUT-18 payment-request invoice of type ecash) the Lightning invoice takes
// over that id, so whatever is waiting on it sees the payment land. Returns
// the amount the user receives: the token's value less the mint's input fee
// and Lightning fee reserve.
export async function redeem({ token, user, invoice = undefined, memo = undefined }) {
  const { proofs } = await decode(token);
  if (!proofs?.length) fail("Token has no proofs");
  if (await ext(proofs)) fail("Unable to receive from other mints");

  // Cheap pre-check so a spent token fails before an invoice is created for
  // it (the melt would reject it anyway, but not before leaving an unpaid
  // invoice on the user's account).
  const states = await new CashuWallet(m).checkProofsStates(proofs);
  if (states.some((p) => p.state !== "UNSPENT")) fail("Token already spent");

  const ks = await keysets();
  const total = sum(proofs);
  const fees = inputFee(proofs, ks);
  let amount = total - fees - 2;
  while (amount > 0 && amount + reserve(amount) + fees > total) amount--;
  if (amount < 1) fail("Token is too small to redeem");

  invoice = await generate({
    invoice: {
      ...(invoice ?? {}),
      id: invoice?.id,
      amount,
      // The invoice amount is exactly what the melt can cover: no tip on top,
      // and no fiat re-pricing of it.
      tip: null,
      fiat: undefined,
      bolt11: undefined,
      bolt12: undefined,
      memo: memo ?? invoice?.memo,
      type: PaymentType.lightning,
    },
    user,
  });

  const quote = await m.createMeltQuote({ unit: "sat", request: invoice.text });
  if (quote.amount + quote.fee_reserve + fees > total)
    fail("Mint fee reserve exceeds the token's value");

  let r = await m.melt({ quote: quote.quote, inputs: proofs });
  for (let i = 0; r.state === "PENDING" && i < 60; i++) {
    await sleep(1000);
    r = await m.checkMeltQuote(quote.quote);
  }
  if (r.state === "PENDING")
    fail("Redemption is still settling; the funds will arrive once it does");
  if (r.state !== "PAID") fail("Redemption failed");

  // The lightning listener credits the settlement. Give it a moment so the
  // caller's payment list already shows it, but the credit doesn't depend on
  // this wait.
  try {
    await wait(() => getPayment(invoice.hash), 50, 200);
  } catch {
    warn("ecash redeemed but credit not yet visible", user.username, invoice.hash);
  }

  return amount;
}

export async function check(token) {
  const { mint, proofs } = await decode(token);
  const total = sum(proofs);

  const external = await ext(proofs);

  // Only ask our own mint about proof states.
  let spent = 0;
  if (!external) {
    const w = new CashuWallet(m);
    for (const [i, p] of (await w.checkProofsStates(proofs)).entries()) {
      if (p.state === "SPENT") spent += proofs[i].amount;
    }
  }

  return { total, spent, mint, external };
}

export function request(uuid, amount, memo) {
  const target = `${URL}/api/ecash/${uuid}`;

  const { POST: type } = PaymentRequestTransportType;
  const transport = [{ type, target }];
  const unit = "sat";

  return new PaymentRequest(
    transport,
    uuid,
    amount,
    unit,
    [config.mintUrl],
    memo,
  ).toEncodedRequest();
}
