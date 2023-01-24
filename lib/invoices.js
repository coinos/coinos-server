import store from "$lib/store";
import { l } from "$lib/logging";
import { emit } from "$lib/sockets";
import { db, g, s } from "$lib/db";
import { bip21, fail } from "$lib/utils";
import { types } from "$lib/payments";
import { v4 } from "uuid";

import bc from "$lib/bitcoin";
import ln from "$lib/ln";

export let invoice = async ({ invoice, user, sender }) => {
  let { currency, tip, amount, rate, request_id, type } = invoice;

  if (amount < 0) fail("amount out of range");
  if (tip > 5 * amount || tip < 0) fail("tip amount out of range");
  tip = tip || 0;

  if (!user) user = sender;
  let uid = await g(`user:${user.username}`);
  user = await g(`user:${uid}`);

  if (!user) fail("user not provided");

  if (!currency) currency = user.currency;
  if (!rate) rate = store.rates[currency];
  if (amount < 0) fail("invalid amount");

  let hash, text;
  if (type === types.lightning) {
    let amt = amount ? `${amount + tip}sat` : "any";
    let r = await ln.invoice(amt, new Date(), "", 3600);

    hash = r.payment_hash;
    text = r.bolt11;
  } else if (type === types.bitcoin) {
    hash = await bc.getNewAddress();
    text = bip21(hash, invoice);
  } else if (type === types.internal) {
    hash = v4();
  } else {
    fail("unrecognized type");
  }

  invoice = {
    ...invoice,
    amount,
    hash,
    text,
    currency,
    rate,
    tip,
    uid,
    received: 0,
    created: Date.now()
  };

  l("creating invoice", user.username, amount, tip, currency, invoice.hash);

  await s(`invoice:${hash}`, invoice);
  await db.lPush(`${uid}:invoices`, hash);

  if (request_id) {
    let request = await g(`request:${request_id}`);
    let { invoice_id: prev } = request;
    request.invoice_id = invoice.id;
    await s(`request:${request_id}`, request);

    if (!prev) emit(request.requester.username, "invoice", invoice);
  }

  return invoice;
};
