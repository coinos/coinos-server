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
  console.log("EVENT", event);
  let {
    payment_hash: hash,
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

    let invoice = await g(`invoice:${hash}`);
    if (!invoice) return warn("received lightning with no invoice", bolt11);

    let payment = await g(`payment:${hash}`);
    if (payment) return warn("already processed", hash);

    await credit(hash, received, invoice.memo, preimage, types.lightning);
  } catch (e) {
    console.log(e);
    err("problem receiving lightning payment", e.message);
  }
}
