import { db, g, s } from "$lib/db";
import ln, { lnListen, LightningUnavailableError } from "$lib/ln";
import { err, l, warn } from "$lib/logging";
import { handleZap } from "$lib/nostr";
import { credit } from "$lib/payments";
import { PaymentType } from "$lib/types";
import { getInvoice, getPayment, getUser } from "$lib/utils";

const LISTENER_RETRY_DELAY = 5000; // 5 seconds
const MAX_LISTENER_RETRIES = 10;
// If the listener has been blocked in waitanyinvoice this long without the call
// returning, AND cl is actually reachable, treat the socket as a zombie and
// force-recycle it. Sized well above normal quiet periods (receives are sparse
// but cl still responds to getinfo) so it only fires on a genuine stall.
const LISTENER_STALL_MS = 5 * 60 * 1000; // 5 minutes
let listenerRetries = 0;
let listenerActive = false;
let lastPayTime = Date.now();
// When the current waitanyinvoice call started — used by the watchdog to tell a
// legitimately-quiet listener (recently armed) from a zombie (armed long ago,
// never returned). Reset every time we (re)enter the wait.
let waitStartedAt = Date.now();
// Incremented whenever the watchdog force-recycles a stalled listener. The
// blocked invocation captures the epoch at entry; if it later unblocks (the
// reset makes its waitanyinvoice reject) it sees the epoch has moved and bows
// out instead of re-arming, so we never run two listeners concurrently.
let listenerEpoch = 0;

export async function listenForLightning() {
  if (listenerActive) {
    warn("lightning listener: already active, skipping duplicate call");
    return;
  }

  listenerActive = true;
  waitStartedAt = Date.now();
  const myEpoch = listenerEpoch;

  try {
    const payIndex = (await g("pay_index")) || 0;
    // l(`lightning listener: waiting for invoice (pay_index=${payIndex})`);

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

    // If the watchdog recycled the listener while this call was blocked, a new
    // listener now owns the stream. Bail without advancing pay_index or
    // processing — the new listener's waitanyinvoice(payIndex) will return this
    // same invoice and handle it, so nothing is lost or double-credited.
    if (myEpoch !== listenerEpoch) return;

    await s("pay_index", pay_index);
    lastPayTime = Date.now();

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
      err("problem receiving lightning payment", e.message);
    }
  } catch (e: any) {
    listenerActive = false;

    // If the watchdog already recycled us (its reset is what made this
    // waitanyinvoice reject), a fresh listener is running — don't retry or
    // re-arm here, or we'd run two listeners.
    if (myEpoch !== listenerEpoch) return;

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

export async function ensureListenerAlive() {
  // Case 1: listener fell over (threw, or never armed) — just restart it.
  if (!listenerActive) {
    warn("lightning listener: not active, restarting");
    listenForLightning();
    return;
  }

  // Case 2: listener claims active. A long-blocked waitanyinvoice is NORMAL
  // during quiet periods — the only way to tell a zombie socket from a healthy
  // idle wait is whether cl actually has a paid invoice the listener is failing
  // to pick up. (The original "blocked > 5min while cl alive" check false-fired
  // every few minutes during normal quiet stretches and needlessly recycled the
  // socket — see 2026-06-07.) So: only act if there's a real backlog.
  if (Date.now() - waitStartedAt < LISTENER_STALL_MS) return;

  // Probe for a backlog: ask cl (on the MAIN socket, not the wedged listen one)
  // whether a paid invoice exists at or after the app's stored pay_index, using
  // waitanyinvoice with a short server-side timeout so it returns fast either
  // way. If it returns an invoice, the listener's socket is stuck while real
  // payments are waiting -> genuine zombie, recycle. If it times out (no waiting
  // invoice), the listener is simply idle and healthy -> leave it alone.
  let backlog = false;
  try {
    const payIndex = (await g("pay_index")) || 0;
    const probe = await ln.waitanyinvoice(payIndex, 2); // 2s server-side timeout
    if (probe?.pay_index) backlog = true;
  } catch (e: any) {
    // CLN returns an error (code 904) on timeout with no waiting invoice — that
    // means NO backlog (healthy). Any other error: stay conservative, don't
    // recycle on ambiguous signals.
    backlog = false;
  }
  if (!backlog) return; // healthy idle wait, not a zombie.

  err(
    `lightning listener: backlog detected while listener blocked ${Math.round(
      (Date.now() - waitStartedAt) / 1000,
    )}s — recycling listen socket`,
  );
  // Bump the epoch first so the wedged invocation bows out when its
  // waitanyinvoice rejects, then drop the socket and re-arm a fresh listener.
  listenerEpoch++;
  try {
    (lnListen as any).reset?.();
  } catch (_) {}
  listenerActive = false;
  setTimeout(listenForLightning);
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
    paid_at,
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
      created: paid_at ? paid_at * 1000 : undefined,
    });

    return p;
  } catch (e) {
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
