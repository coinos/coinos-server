import { db, g, s } from "$lib/db";
import ln from "$lib/ln";
import { err, warn } from "$lib/logging";
import { handleZap } from "$lib/nostr";
import { credit } from "$lib/payments";
import { PaymentType } from "$lib/types";
import { getInvoice, getPayment, getUser } from "$lib/utils";

export async function listenForLightning() {
  const inv = await ln.waitanyinvoice((await g("pay_index")) || 0);
  const {
    local_offer_id,
    bolt11,
    bolt12,
    description,
    pay_index,
    payment_hash,
    amount_received_msat,
    payment_preimage: preimage,
  } = inv;

  await s("pay_index", pay_index);
  setTimeout(listenForLightning);

  const received = Math.round(amount_received_msat / 1000);

  try {
    if (!preimage) return;

    const invoice = await getInvoice(bolt11 ?? local_offer_id);
    if (!invoice) return warn("received lightning with no invoice", bolt11);

    const p = await getPayment(bolt11 || bolt12);
    if (p) return warn("already processed", bolt11 || bolt12);

    if (invoice?.memo) {
      try {
        if (JSON.parse(description).kind === 9734) {
          const { pubkey } = await getUser(invoice.uid);
          handleZap(inv, pubkey);
        }
      } catch (e) {
        if (!e.message.includes("Unexpected"))
          warn("failed to handle zap", e.message);
      }
    }

    await credit({
      hash: bolt11 || bolt12,
      amount: received,
      memo: invoice.memo,
      ref: preimage,
      type: bolt12 ? PaymentType.bolt12 : PaymentType.lightning,
      payment_hash,
    });
  } catch (e) {
    console.log(e);
    err("problem receiving lightning payment", e.message);
  }
}

export async function replay(index) {
  const inv = await ln.waitanyinvoice(index - 1);
  const {
    local_offer_id,
    bolt11,
    bolt12,
    description,
    amount_received_msat,
    payment_preimage: preimage,
  } = inv;

  const received = Math.round(amount_received_msat / 1000);

  try {
    if (!preimage) return;

    const invoice = await getInvoice(bolt11 ?? local_offer_id);
    if (!invoice) return warn("received lightning with no invoice", bolt11);

    const p = await getPayment(bolt11 || bolt12);
    if (p) return warn("already processed", bolt11 || bolt12);

    if (invoice?.memo) {
      try {
        if (JSON.parse(description).kind === 9734) {
          const { pubkey } = await getUser(invoice.uid);
          handleZap(inv, pubkey);
        }
      } catch (e) {
        if (!e.message.includes("Unexpected"))
          warn("failed to handle zap", e.message);
      }
    }

    await credit({
      hash: bolt11 || bolt12,
      amount: received,
      memo: invoice.memo,
      ref: preimage,
      type: bolt12 ? PaymentType.bolt12 : PaymentType.lightning,
    });
  } catch (e) {
    console.log(e);
    err("problem receiving lightning payment", e.message);
  }
}

export const fixBolt12 = async (_, res) => {
  for await (const k of db.scanIterator({ MATCH: "payment:*" })) {
    const p = await g(k);
    if (p.type === "bolt12") {
      console.log(k);
      const { invoices } = await ln.listinvoices({ invstring: p.hash });
      const { local_offer_id } = invoices[0];
      const oid = await g(`payment:${local_offer_id}`);
      const op = await g(`payment:${oid}`);
      if (op) {
        db.del(`payment:${oid}`);
        db.del(`payment:${local_offer_id}`);
        db.decrBy(`balance:${op.uid}`, op.amount);
      }
    }
  }

  res.send({});
};
