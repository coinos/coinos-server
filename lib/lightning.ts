import { db, g, s } from "$lib/db";
import ln, { lnListen, LightningUnavailableError } from "$lib/ln";
import { err, l, warn } from "$lib/logging";
import { handleZap } from "$lib/nostr";
import { credit } from "$lib/payments";
import { PaymentType } from "$lib/types";
import { getInvoice, getPayment, getUser } from "$lib/utils";

const LISTENER_RETRY_DELAY = 5000; // 5 seconds
const MAX_LISTENER_RETRIES = 10;
let listenerRetries = 0;
let listenerActive = false;

export async function listenForLightning() {
  if (listenerActive) {
    warn("lightning listener: already active, skipping duplicate call");
    return;
  }

  listenerActive = true;

  try {
    const payIndex = (await g("pay_index")) || 0;
    l(`lightning listener: waiting for invoice (pay_index=${payIndex})`);

    const inv = await lnListen.waitanyinvoice(payIndex);
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

    // Reset retry counter on successful receive
    if (listenerRetries > 0) {
      l(`lightning listener: recovered after ${listenerRetries} retries`);
    }
    listenerRetries = 0;
    listenerActive = false;

    // Schedule next listen
    setTimeout(listenForLightning);

    const received = Math.round(amount_received_msat / 1000);

    try {
      if (!preimage) return;

      const invoice = await getInvoice(bolt11 ?? local_offer_id ?? bolt12);
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
  } catch (e: any) {
    listenerActive = false;
    const errorCode = e?.code ?? e?.errno ?? "unknown";
    const errorMsg = e?.message ?? String(e);

    err(
      `lightning listener: error waiting for invoice`,
      `code=${errorCode}`,
      `error=${errorMsg}`
    );

    if (e instanceof LightningUnavailableError) {
      err("lightning listener: RPC socket unavailable");
    }

    listenerRetries++;

    if (listenerRetries >= MAX_LISTENER_RETRIES) {
      err(
        `lightning listener: ${MAX_LISTENER_RETRIES} consecutive failures, ` +
          `last error: ${errorMsg}`
      );
      err("lightning listener: exiting process to trigger container restart");

      setTimeout(() => {
        process.exit(1);
      }, 1000);
      return;
    }

    warn(
      `lightning listener: retry ${listenerRetries}/${MAX_LISTENER_RETRIES} ` +
        `in ${LISTENER_RETRY_DELAY / 1000}s`
    );
    setTimeout(listenForLightning, LISTENER_RETRY_DELAY);
  }
}

export async function replay(index) {
  const inv = await lnListen.waitanyinvoice(index - 1);
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

    const invoice = await getInvoice(bolt11 ?? local_offer_id ?? bolt12);
    if (!invoice) return warn("received lightning with no invoice", bolt11);

    let p = await getPayment(bolt11 || bolt12);
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

    p = await credit({
      hash: bolt11 || bolt12,
      amount: received,
      memo: invoice.memo,
      ref: preimage,
      type: bolt12 ? PaymentType.bolt12 : PaymentType.lightning,
    });

    return p;
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
