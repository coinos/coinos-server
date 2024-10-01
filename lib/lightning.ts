import { handleZap } from "$lib/nostr";
import ln from "$lib/ln";
import { err, warn } from "$lib/logging";
import { g, s } from "$lib/db";
import { credit, types } from "$lib/payments";
import { getPayment } from "$lib/utils";

export async function listenForLightning() {
  let inv = await ln.waitanyinvoice((await g("pay_index")) || 0);
  let {
    bolt11,
    description,
    pay_index,
    amount_received_msat,
    payment_preimage: preimage,
  } = inv;

  await s("pay_index", pay_index);
  setTimeout(listenForLightning);

  let received = Math.round(amount_received_msat / 1000);

  try {
    if (!preimage) return;

    let id = await g(`invoice:${bolt11}`);
    let invoice = await g(`invoice:${id}`);
    if (!invoice) return warn("received lightning with no invoice", bolt11);

    if (invoice && invoice.memo) {
      try {
        if (JSON.parse(description).kind === 9734) await handleZap(inv);
      } catch (e) {
        if (!e.message.startsWith("Unexpected"))
          warn("failed to handle zap", e.message);
      }
    }

    let p = await getPayment(bolt11);
    if (p) return warn("already processed", bolt11);

    await credit({ hash:bolt11, amount:received, memo:invoice.memo, ref:preimage, type:types.lightning});
  } catch (e) {
    console.log(e);
    err("problem receiving lightning payment", e.message);
  }
}
