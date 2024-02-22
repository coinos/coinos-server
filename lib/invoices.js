import store from "$lib/store";
import { l } from "$lib/logging";
import { emit } from "$lib/sockets";
import { db, g, s } from "$lib/db";
import { getUser, bip21, fail, SATS } from "$lib/utils";
import { types } from "$lib/payments";
import { v4 } from "uuid";

import lq from "$lib/liquid";
import bc from "$lib/bitcoin";
import ln from "$lib/ln";

export let generate = async ({ invoice, user, sender, memo }) => {
  let {
    currency,
    expiry,
    fiat,
    tip,
    amount,
    items = [],
    rate,
    request_id,
    prompt,
    type,
    webhook,
    secret,
  } = invoice;

  amount = parseInt(amount || 0);
  tip = parseInt(tip) || null;

  if (user) user = await getUser(user.username);
  else if (sender) user = await getUser(sender.username);
  if (!user) fail("user not provided");

  if (!currency) currency = user.currency;
  if (!rate) rate = store.rates[currency];
  if (fiat) amount = Math.round((SATS * fiat) / rate);
  if (amount < 0) fail("invalid amount");

  let id = v4();

  let hash, text;
  if (type === types.lightning) {
    let r = await ln.invoice({
      amount_msat: amount ? `${amount + tip}sat` : "any",
      label: id,
      description: memo || "",
      expiry: expiry || 60 * 60 * 24 * 30,
      deschashonly: true,
      cltv: 19,
    });

    hash = r.bolt11;
    text = r.bolt11;
  } else if (type === types.bitcoin) {
    hash = await bc.getNewAddress();
    text = bip21(hash, invoice);
  } else if (type === types.liquid) {
    hash = await lq.getNewAddress();
    text = bip21(hash, invoice);
  } else if (type === types.internal) {
    hash = id;
  } else {
    fail("unrecognized type");
  }

  invoice = {
    amount,
    created: Date.now(),
    currency,
    hash,
    id,
    items,
    memo,
    rate,
    pending: 0,
    received: 0,
    request_id,
    prompt,
    secret,
    text,
    tip,
    type,
    uid: user.id,
    webhook,
  };

  if (type === "liquid") {
    let { unconfidential } = await lq.getAddressInfo(hash);
    await s(`invoice:${unconfidential}`, id);
  }

  await s(`invoice:${hash}`, id);
  await s(`invoice:${id}`, invoice);
  await db.lPush(`${user.id}:invoices`, id);

  if (request_id) {
    let request = await g(`request:${request_id}`);
    if (request) {
      let { invoice_id: prev } = request;
      request.invoice_id = id;
      await s(`request:${request_id}`, request);

      if (!prev) emit(request.requester_id, "invoice", invoice);
    }
  }

  return invoice;
};
