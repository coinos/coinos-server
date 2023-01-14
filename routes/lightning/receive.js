import store from "$lib/store";
import { emit } from "$lib/sockets";
import config from "$config";
import { notify } from "$lib/notifications";
import { callWebhook } from "$lib/webhooks";
import { computeConversionFee } from "./conversionFee";
import ln from "$lib/ln";
import { l, err, warn } from "$lib/logging";
import { g, s, rd } from "$lib/redis";

let handle = async () => {
  let {
    payment_hash,
    bolt11: request,
    pay_index,
    status,
    msatoshi_received,
    payment_preimage: secret
  } = await ln.waitanyinvoice(await g("pay_index"));

  await s("pay_index", pay_index);

  let received = Math.round(msatoshi_received / 1000);

  try {
    l("incoming lightning payment", received);

    if (!secret) return;
    let account, total, user;

    let invoice = await g(`invoice:${payment_hash}`);
    if (!invoice) return warn("received lightning with no invoice", request);

    let { text: hash, currency, memo, rate, tip, user_id } = invoice;
    let amount = parseInt(received) - tip;
    if (amount < 0) throw new Error("amount out of range");

    let payment = {
      user_id,
      hash,
      memo,
      amount,
      currency,
      secret,
      rate,
      tip,
      invoice_id: invoice.id
    };

    total = amount + tip;

    invoice.status = "paid";
    invoice.received += total;
    await s(`invoice:${payment_hash}`, invoice);

    let t = async () => {
      await rd.watch(`user:${user_id}`);
      user = await g(`user:${user_id}`);
      user.balance += total;
      let m = await rd.multi();
      await s(`user:${user.id}`, user);
      if (!(await m.exec())) t();
    };
    await t();

    payment.invoice = invoice;
    callWebhook(invoice, payment);

    emit(user.username, "payment", payment);
    notify(user, `Received ${total} SAT`);

    l("lightning payment received", user.username, payment.amount, payment.tip);
  } catch (e) {
    console.log(e);
    err("problem receiving lightning payment", e.message);
  }
};

let listen = async () => {
  await handle();
  listen();
};

listen();
