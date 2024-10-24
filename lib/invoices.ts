import config from "$config";
import { db, g, s } from "$lib/db";
import ln from "$lib/ln";
import { types } from "$lib/payments";
import { emit } from "$lib/sockets";
import { SATS, bip21, fail, getUser } from "$lib/utils";
import rpc from "@coinos/rpc";
import { v4 } from "uuid";

const bc = rpc(config.bitcoin);
const lq = rpc(config.liquid);

export const generate = async ({ invoice, user }) => {
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

  amount = parseInt(amount || 0);
  tip = parseInt(tip) || null;

  if (user) user = await getUser(user.username);
  if (!user) fail("user not provided");

  let account = await g(`account:${aid}`);
  if (!account) account = await g(`account:${user.id}`);
  if (!account) fail("account not found");

  const rates = await g("rates");
  if (!currency) currency = user.currency;
  if (!rate) rate = rates[currency];
  if (fiat) amount = Math.round((SATS * fiat) / rate);
  if (amount < 0) fail("invalid amount");
  if (tip < 0) fail("invalid tip");
  if (rate < 0) fail("invalid rate");
  if (memo && memo.length > 5000) fail("memo too long");

  const id = v4();

  let hash, text, path;

  if (account.seed) {
    type = "bitcoin";
    const node = rpc({ ...config[type], wallet: aid });
    hash = await node.getNewAddress();
    text = bip21(hash, invoice);

    ({ hdkeypath: path } = await node.getAddressInfo(hash));
  } else if (type === types.lightning) {
    let r;
    if (bolt11) {
      const { id: nodeid } = await ln.getinfo();
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
    fail(`unrecognized type ${type}`);
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
    path,
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
