import { emit } from "$lib/sockets";
import config from "$config";
import { notify } from "$lib/notifications";
import { callWebhook } from "$lib/webhooks";
import ln from "$lib/ln";
import { l, err, warn } from "$lib/logging";
import { g, s, t, db } from "$lib/db";
import { credit, types } from "$lib/payments";

export async function listenForLightning() {
  let event = await ln.waitanyinvoice(await g("pay_index"));
  let {
    bolt11,
    pay_index,
    status,
    amount_received_msat,
    payment_preimage: preimage
  } = event;

  await s("pay_index", pay_index);
  setTimeout(listenForLightning);

  let received = Math.round(amount_received_msat / 1000);

  try {
    l("incoming lightning payment", received);

    if (!preimage) return;

    let invoice = await g(`invoice:${bolt11}`);
    if (!invoice) return warn("received lightning with no invoice", bolt11);

    let payment = await g(`payment:${bolt11}`);
    if (payment) return warn("already processed", bolt11);

    await credit(bolt11, received, invoice.memo, preimage, types.lightning);
  } catch (e) {
    console.log(e);
    err("problem receiving lightning payment", e.message);
  }
}
