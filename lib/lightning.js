import { emit } from "$lib/sockets";
import config from "$config";
import { notify } from "$lib/notifications";
import { callWebhook } from "$lib/webhooks";
import ln from "$lib/ln";
import { l, err, warn } from "$lib/logging";
import { g, s, t, db } from "$lib/db";
import { credit, types } from "$lib/payments";

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

    await credit(hash, amount, memo, preimage, types.lightning);
  } catch (e) {
    console.log(e);
    err("problem receiving lightning payment", e.message);
  }
}
