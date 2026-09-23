import { db, g } from "$lib/db";
import ln, { lnListen, LightningUnavailableError } from "$lib/ln";
import { err, l, warn } from "$lib/logging";
import { handleZap } from "$lib/nostr";
import { credit } from "$lib/payments";
import { PaymentType } from "$lib/types";
import { getInvoice, getPayment, getUser } from "$lib/utils";

const LISTENER_RETRY_DELAY = 5000; // 5 seconds
const MAX_LISTENER_RETRIES = 10;
// Never leave waitanyinvoice as an unbounded client-side promise. CLN's
// server-side timeout returns code 904 during an ordinary quiet period; that is
// treated as a clean re-arm below. A dead/half-open socket can therefore hold
// the listener for at most the watchdog window instead of indefinitely.
const LISTENER_WAIT_TIMEOUT_SECONDS = 30;
const LISTENER_STALL_MS = 90 * 1000;
const PROCESSING_STALL_MS = 5 * 60 * 1000;
let listenerRetries = 0;
let listenerActive = false;
let lastPayTime = Date.now();
let listenerPhase: "idle" | "waiting" | "processing" = "idle";
let phaseStartedAt = Date.now();
// Incremented whenever the watchdog force-recycles a stalled listener. The
// blocked invocation captures the epoch at entry; if it later unblocks (the
// reset makes its waitanyinvoice reject) it sees the epoch has moved and bows
// out instead of re-arming, so we never run two listeners concurrently.
let listenerEpoch = 0;

// Recover the invoice listener the instant its long-poll socket dies (e.g. a cl
// restart) instead of waiting up to LISTENER_STALL_MS for the stall watchdog.
// waitanyinvoice is a NO_TIMEOUT long-poll, so a dead socket leaves it blocked
// forever with no error — this onDrop signal is the only prompt trigger. Bump the
// epoch so the (possibly forever-blocked) old invocation bows out, mark inactive,
// and re-arm. If cl is still down, ensure()'s backoff + the retry loop below wait
// it out. Debounced so a burst of socket errors recycles once.
let recycleArmed = false;
(lnListen as any).onDrop?.(() => {
  if (!listenerActive || recycleArmed) return;
  recycleArmed = true;
  listenerEpoch++;
  listenerActive = false;
  listenerPhase = "idle";
  warn("lightning listener: listen socket dropped — recycling immediately");
  setTimeout(() => {
    recycleArmed = false;
    listenForLightning();
  }, 100);
});

export async function listenForLightning() {
  if (listenerActive) {
    warn("lightning listener: already active, skipping duplicate call");
    return;
  }

  listenerActive = true;
  listenerPhase = "waiting";
  phaseStartedAt = Date.now();
  const myEpoch = listenerEpoch;

  try {
    const payIndex = (await g("pay_index")) || 0;
    // l(`lightning listener: waiting for invoice (pay_index=${payIndex})`);

    const inv = await lnListen.waitanyinvoice(
      payIndex,
      LISTENER_WAIT_TIMEOUT_SECONDS,
    );
    const {
      label,
      local_offer_id,
      bolt11,
      bolt12,
      description,
      invreq_payer_note,
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

    // We are no longer blocked in waitanyinvoice. Track processing separately
    // so the watchdog never resets a healthy socket merely because a ledger
    // write or downstream notification is slow.
    listenerPhase = "processing";
    phaseStartedAt = Date.now();
    const received = Math.round(amount_received_msat / 1000);

    // Process the settlement before advancing pay_index. Advancing first loses
    // the credit permanently if Valkey is loading/restarting between the cursor
    // write and credit() (the 2026-08-15 gap at pay indexes 1057448-1057518).
    // The inner function keeps intentional skips on the common commit path;
    // genuine processing errors escape to the retry handler with the old cursor.
    await (async () => {
      if (!preimage) return;

      // The mint (nutshell) shares this cl node, so waitanyinvoice also fires for
      // mint-quote invoices. Those are owned by the mint (it issues ecash for
      // them) and must NOT credit a coinos balance — otherwise a single payment
      // is credited twice (coinos balance + ecash = double-mint exploit). The
      // mint labels its invoices "lbl<random>"; coinos labels are
      // "<uuid> <username> <ts>". Never credit a mint-owned invoice.
      if (typeof label === "string" && label.startsWith("lbl"))
        return warn("skipping mint-owned invoice (not a coinos deposit)", label, bolt11);

      const invoice = await getInvoice(bolt11 ?? local_offer_id ?? bolt12);
      if (!invoice) return warn("received lightning with no invoice", bolt11);

      // A deleted account's invoice or bolt12 offer can still be paid (OCEAN
      // payouts to a deleted user's offer, 2026-09-05). Nothing can be
      // credited, and the post-credit persistence check below would throw and
      // wedge the listener on this settlement forever. Record and skip.
      if (!(await getUser(invoice.uid))) {
        await db.sAdd("missing", preimage);
        return warn("received lightning for missing user", invoice.uid, bolt11 ?? bolt12, received);
      }

      const p = await getPayment(bolt11 || bolt12);
      if (p) return warn("already processed", bolt11 || bolt12);

      if (invoice?.memo) {
        // A non-JSON description just means this isn't a zap (the common case) —
        // skip silently. Only a real kind-9734 zap request that fails to process
        // is worth a warning. (The old `!includes("Unexpected")` guard was V8's
        // parse-error wording; Bun's is "Unable to parse JSON string", so every
        // non-zap memo'd invoice slipped through and spammed this warning.)
        let zapreq;
        try { zapreq = JSON.parse(description); } catch { zapreq = null; }
        if (zapreq?.kind === 9734) {
          try {
            const { pubkey } = await getUser(invoice.uid);
            handleZap(inv, pubkey);
          } catch (e) {
            warn("failed to handle zap", e.message);
          }
        }
      }

      const paymentRequest = bolt11 || bolt12;
      await credit({
        hash: paymentRequest,
        amount: received,
        // A bolt12 payer note (e.g. nostr:nip177:<zap-intent-id>) identifies
        // this specific payment; the offer's own memo is just its static label
        memo: invreq_payer_note || invoice.memo,
        ref: preimage,
        type: bolt12 ? PaymentType.bolt12 : PaymentType.lightning,
        payment_hash,
      });

      // credit() may decline a duplicate idempotency claim. Only advance the
      // listener once the durable payment pointer proves the ledger write won —
      // unless the preimage was already credited by an earlier settlement (a
      // reused merchant preimage), which can never persist and would otherwise
      // wedge the listener in a restart loop.
      if (!(await getPayment(paymentRequest))) {
        if (preimage && (await db.get(`credited:${preimage}`)))
          return warn("preimage already credited, skipping", paymentRequest);
        throw new Error(`lightning credit did not persist for ${paymentRequest}`);
      }
    })();

    // db.set is awaited directly: s() is intentionally fire-and-forget and an
    // `await s(...)` would not wait for Redis to persist the cursor.
    await db.set("pay_index", JSON.stringify(pay_index));

    // If the watchdog recycled this invocation while it was processing, the
    // replacement listener owns scheduling. The credit is idempotent and the
    // committed cursor lets that listener continue from the next settlement.
    if (myEpoch !== listenerEpoch) return;

    lastPayTime = Date.now();

    // Reset retry counter only after both the ledger operation and cursor write
    // have succeeded.
    if (listenerRetries > 0) {
      l(`lightning listener: recovered after ${listenerRetries} retries`);
    }
    listenerRetries = 0;
    listenerActive = false;
    listenerPhase = "idle";

    // Schedule the next listen only after this settlement is durable.
    setTimeout(listenForLightning);
  } catch (e: any) {
    const failedPhase = listenerPhase;
    listenerActive = false;
    listenerPhase = "idle";

    // If the watchdog already recycled us (its reset is what made this
    // waitanyinvoice reject), a fresh listener is running — don't retry or
    // re-arm here, or we'd run two listeners.
    if (myEpoch !== listenerEpoch) return;

    const errorCode = e?.code ?? e?.errno ?? "unknown";
    const errorMsg = e?.message ?? String(e);

    // CLN error 904 is the expected result of a server-side wait timeout with
    // no newly paid invoice. It proves the socket is responsive; immediately
    // re-arm without incrementing the failure counter or emitting an error.
    if (
      failedPhase === "waiting" &&
      (Number(errorCode) === 904 || /timed out/i.test(errorMsg))
    ) {
      listenerRetries = 0;
      setTimeout(listenForLightning);
      return;
    }

    err(
      `lightning listener: error handling invoice`,
      `code=${errorCode}`,
      `error=${errorMsg}`
    );

    // A cl restart makes ensure() throw LightningUnavailableError until the socket
    // returns — expected, self-heals, and restarting the app can't fix a down cl.
    // So don't count it toward the process-exit escalation; just keep retrying and
    // resume within LISTENER_RETRY_DELAY of cl coming back. Only genuine listener
    // errors climb toward a container restart.
    if (e instanceof LightningUnavailableError) {
      err("lightning listener: RPC socket unavailable");
      warn(`lightning listener: cl unavailable, retrying in ${LISTENER_RETRY_DELAY / 1000}s`);
      setTimeout(listenForLightning, LISTENER_RETRY_DELAY);
      return;
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

  // Processing and waiting are different failure modes. Resetting the listen
  // socket cannot repair a slow credit and risks overlapping two processors.
  // Surface it loudly for intervention, but leave the single owner intact.
  const phaseAge = Date.now() - phaseStartedAt;
  if (listenerPhase === "processing") {
    if (phaseAge >= PROCESSING_STALL_MS) {
      err(
        `lightning listener: invoice processing stalled ${Math.round(
          phaseAge / 1000,
        )}s — not starting a concurrent processor`,
      );
    }
    return;
  }

  // A normal quiet wait returns code 904 every 30 seconds and re-arms. Reaching
  // this age means the dedicated socket itself is stuck. Confirm a real backlog
  // over the main socket before recycling it.
  if (listenerPhase !== "waiting" || phaseAge < LISTENER_STALL_MS) return;

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
      phaseAge / 1000,
    )}s — recycling listen socket`,
  );
  // Bump the epoch first so the wedged invocation bows out when its
  // waitanyinvoice rejects, then drop the socket and re-arm a fresh listener.
  listenerEpoch++;
  try {
    (lnListen as any).reset?.();
  } catch (_) {}
  listenerActive = false;
  listenerPhase = "idle";
  setTimeout(listenForLightning);
}

export function getLightningListenerStatus() {
  return {
    active: listenerActive,
    phase: listenerPhase,
    phaseAgeMs: Date.now() - phaseStartedAt,
    lastPayTime,
    retries: listenerRetries,
  };
}

export async function replay(index) {
  const inv = await lnListen.waitanyinvoice(index - 1);
  const {
    local_offer_id,
    bolt11,
    bolt12,
    description,
    invreq_payer_note,
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
      // Non-JSON description = not a zap (common case); skip silently. Only a
      // real kind-9734 zap request that fails processing warrants a warning.
      // (The old `!includes("Unexpected")` guard was V8 wording; Bun's parse
      // error is "Unable to parse JSON string", so non-zaps spammed the warning.)
      let zapreq;
      try { zapreq = JSON.parse(description); } catch { zapreq = null; }
      if (zapreq?.kind === 9734) {
        try {
          const { pubkey } = await getUser(invoice.uid);
          handleZap(inv, pubkey);
        } catch (e) {
          warn("failed to handle zap", e.message);
        }
      }
    }

    p = await credit({
      hash: bolt11 || bolt12,
      amount: received,
      memo: invreq_payer_note || invoice.memo,
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
