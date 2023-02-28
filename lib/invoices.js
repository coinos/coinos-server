import store from "$lib/store";
import { l } from "$lib/logging";
import { emit } from "$lib/sockets";
import { db, g, s } from "$lib/db";
import { bip21, fail } from "$lib/utils";
import { types } from "$lib/payments";
import { v4 } from "uuid";

import bc from "$lib/bitcoin";
import ln from "$lib/ln";

export let generate = async ({ invoice, user, sender, memo }) => {
  let { currency, tip, amount, rate, request_id, type } = invoice;

  amount = parseInt(amount || 0);
  tip = parseInt(tip || 0);

  if (amount < 0) fail("amount out of range");

  if (!user) user = sender;
  let uid = await g(`user:${user.username.toLowerCase()}`);
  user = await g(`user:${uid}`);

  if (!user) fail("user not provided");

  if (!currency) currency = user.currency;
  if (!rate) rate = store.rates[currency];
  if (amount < 0) fail("invalid amount");

  let hash, text;
  if (type === types.lightning) {
    let r = await ln.invoice(
      amount ? `${amount + tip}sat` : "any",
      new Date(),
      memo || "",
      3600,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );

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
    amount,
      created: Date.now(),
    currency,
    hash,
    rate,
    received: 0,
    request_id,
    text,
    tip,
    type,
    uid,
  };

  l("creating invoice", user.username, amount, tip, currency, invoice.hash);

  await s(`invoice:${hash}`, invoice);
  await db.lPush(`${uid}:invoices`, hash);

  if (request_id) {
    let request = await g(`request:${request_id}`);
    if (request) {
      let { invoice_id: prev } = request;
      request.invoice_id = hash;
      await s(`request:${request_id}`, request);

      if (!prev) emit(request.requester_id, "invoice", invoice);
    }
  }

  return invoice;
};
