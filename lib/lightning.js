import { emit } from "$lib/sockets";
import config from "$config";
import { notify } from "$lib/notifications";
import { callWebhook } from "$lib/webhooks";
import ln from "$lib/ln";
import { l, err, warn } from "$lib/logging";
import { g, s, t, db } from "$lib/db";

export async function listenForLightning() {
  let {
    payment_hash: hash,
    bolt11,
    pay_index,
    status,
    msatoshi_received,
    payment_preimage: preimage
  } = await ln.waitanyinvoice(await g("pay_index"));

  await s("pay_index", pay_index);
  setTimeout(listenForLightning);

  let received = Math.round(msatoshi_received / 1000);

  try {
    l("incoming lightning payment", received);

    if (!preimage) return;

    let invoice = await g(`invoice:${hash}`);
    if (!invoice) return warn("received lightning with no invoice", bolt11);

    let { currency, memo, rate, tip, uid } = invoice;
    let amount = parseInt(received) - tip;
    if (amount < 0) throw new Error("amount out of range");

    let user = await g(`user:${uid}`);

    let payment = {
      amount,
      created: Date.now(),
      currency,
      fee: 0,
      hash,
      memo,
      preimage,
      rate,
      tip,
      type: "lightning",
      uid
    };

    invoice.status = "paid";
    invoice.received += received;

    await s(`invoice:${hash}`, invoice);
    await db.incrBy(`balance:${uid}`, received);
    payment.invoice = invoice;
    await s(`payment:${hash}`, payment);
    await db.lPush(`${uid}:payments`, hash);

    callWebhook(invoice, payment);

    emit(uid, "payment", payment);
    notify(user, `Received ${received} SAT`);

    l("lightning payment received", user.username, payment.amount, payment.tip);
  } catch (e) {
    console.log(e);
    err("problem receiving lightning payment", e.message);
  }
}
