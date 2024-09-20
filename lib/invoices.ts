import config from "$config";
import { emit } from "$lib/sockets";
import { db, g, s } from "$lib/db";
import { getUser, bip21, fail, SATS } from "$lib/utils";
import { types } from "$lib/payments";
import { v4 } from "uuid";
import rpc from "@coinos/rpc";
import ln from "$lib/ln";

let bc = rpc(config.bitcoin);
let lq = rpc(config.liquid);

export let generate = async ({ invoice, user }) => {
  let {
    bolt11,
    aid,
    currency,
    expiry,
    fiat,
    tip,
    amount,
    items = [],
    rate,
    request_id,
    memo,
    memoPrompt,
    prompt,
    type = types.lightning,
    webhook,
    secret,
  } = invoice;

  let account = await g(`account:${aid}`);
  amount = parseInt(amount || 0);
  tip = parseInt(tip) || null;

  if (user) user = await getUser(user.username);
  if (!user) fail("user not provided");

  let rates = await g("rates");
  if (!currency) currency = user.currency;
  if (!rate) rate = rates[currency];
  if (fiat) amount = Math.round((SATS * fiat) / rate);
  if (amount < 0) fail("invalid amount");
  if (tip < 0) fail("invalid tip");
  if (rate < 0) fail("invalid rate");
  if (memo && memo.length > 5000) fail("memo too long");

  let id = v4();

  let hash, text;

  if (account.seed) {
    type = "bitcoin";
    let node = rpc({ ...config[type], wallet: aid });
    hash = await node.getNewAddress();
    text = bip21(hash, invoice);
  } else if (type === types.lightning) {
    let r;
    if (bolt11) {
      let { id: nodeid } = await ln.getinfo();
      r = await ln.decode(bolt11);
      if (r.payee !== nodeid) fail("invalid invoice");
      amount = Math.round(r.amount_msat / 1000);
      r.bolt11 = bolt11;
    } else {
      expiry ||= 60 * 60 * 24 * 30;
      r = await ln.invoice({
        amount_msat: amount ? `${amount + tip}sat` : "any",
        label: id,
        description: memo || "",
        expiry,
        deschashonly: true,
        cltv: 19,
      });
    }

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
    aid,
    created: Date.now(),
    currency,
    hash,
    expiry,
    id,
    items,
    memo,
    rate,
    pending: 0,
    received: 0,
    request_id,
    memoPrompt,
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
