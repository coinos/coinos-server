import config from "$config";
import { db, g, s } from "$lib/db";
import { request } from "$lib/ecash";
import ln from "$lib/ln";
import { emit } from "$lib/sockets";
import { SATS, bip21, fail, getInvoice, getUser } from "$lib/utils";
import rpc from "@coinos/rpc";
import { v4 } from "uuid";

import { PaymentType } from "$lib/types";

const bc = rpc(config.bitcoin);
const lq = rpc(config.liquid);

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
    hash,
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
  if (tip < 0) fail("invalid tip");
  if (rate < 0) fail("invalid rate");
  if (memo && memo.length > 5000) fail("memo too long");

  if (!id) id = v4();

  let text;
  let paymentHash;

  if (account.type === "ark") {
    type = PaymentType.ark;
    text = account.arkAddress;
  } else if (account.seed) {
    type = PaymentType.bitcoin;
    const node = rpc({ ...config[type], wallet: aid });
    hash = await node.getNewAddress({ address_type });
    text = bip21(hash, invoice);

    ({ hdkeypath: path } = await node.getAddressInfo(hash));
  } else if (type === PaymentType.lightning) {
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
        label: `${id} ${user.username} ${Date.now()}`,
        description: memo || "",
        expiry,
        deschashonly: true,
        cltv: 19,
      });
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

      if (await getInvoice(r.offer_id)) fail("Duplicate offer exists");
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
