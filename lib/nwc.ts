import config from "$config";
import { archive, db, g, gf } from "$lib/db";
import { generate, getUserOffer } from "$lib/invoices";
import ln from "$lib/ln";
import { err, l, warn } from "$lib/logging";
import {
  decryptPayload,
  encryptPayload,
  encryptionSchemes,
  handleZap,
  serverPubkey,
  serverPubkey2,
  serverSecret,
  serverSecret2,
} from "$lib/nostr";
import { sendInternal, sendKeysend, sendLightning } from "$lib/payments";
import { fail, getInvoice, sleep } from "$lib/utils";
import rpc from "@coinos/rpc";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { Relay } from "nostr";
import { finalizeEvent } from "nostr-tools";
import type { UnsignedEvent } from "nostr-tools";

const serverKeys = {
  [serverPubkey]: serverSecret,
  [serverPubkey2]: serverSecret2,
};

const result = (result) => ({ result });
const error = (error) => ({ error });
const bc = rpc(config.bitcoin);

const methods = [
  "pay_keysend",
  "pay_invoice",
  "pay",
  "receive",
  "get_balance",
  "get_info",
  "make_invoice",
  "lookup_invoice",
  "list_transactions",
];

const week = 7 * 24 * 60 * 60;
const nwcEventMaxAgeSeconds = 5 * 60;
// Tolerated clock skew for future-dated events. Events further ahead than this
// are rejected so a captured, future-dated signed event can't be replayed later.
const nwcClockSkewSeconds = 60;
const handledKey = "handled:nwc";

// Per-pubkey rate limiting for NWC requests. Raised 5 -> 60/min: normal client
// usage (a balance check or two + a payment + a few lookup_invoice reconciles)
// blows past 5 trivially, and over-limit requests were dropped SILENTLY with no
// reply — indistinguishable from lost replies. 60/min (1/s avg) is ample
// headroom for interactive use while still capping abuse.
const nwcRateLimit = 60; // max requests per minute per pubkey
const nwcRateWindow = 60 * 1000; // 1 minute in ms
const nwcRequestTimes: Map<string, number[]> = new Map();

// Per-app async mutex for spends. checkBudget reads `${pubkey}:payments` and the
// spend is only recorded after the payment settles, so N concurrent requests on
// one connection would each read the same stale "spent" total and all pass —
// up to N × max_amount out. Serializing the check + send + record per app closes
// that window (same shape as withLimitLock for the asset-type limits).
const budgetLocks: Map<string, Promise<void>> = new Map();
const withBudgetLock = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const prev = budgetLocks.get(key) || Promise.resolve();
  let release: () => void = () => {};
  const next = new Promise<void>((res) => {
    release = res;
  });
  budgetLocks.set(key, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
};
const budgetedMethods = new Set(["pay_invoice", "pay", "pay_keysend"]);

export default () => {
  let r: any;
  let heartbeatInterval: any;
  let infoCheckInterval: any;

  // Publish the kind 13194 info event and CONFIRM the relay stored it. The
  // long-lived NWC socket's send is fire-and-forget (await wait_connected; ws.send)
  // and was called without await — so a send that rejected (e.g. ws in CLOSING
  // state during a reconnect) was silently dropped while we logged success,
  // leaving clients with "no info event" until a manual republish. Publish over a
  // fresh short-lived socket and wait for the relay's OK, retrying a few times.
  async function publishInfo(pk: string, sk: string) {
    const info = finalizeEvent(
      {
        created_at: Math.floor(Date.now() / 1000),
        kind: 13194,
        tags: [
          ["p", pk],
          ["notifications", "payment_received payment_sent"],
          ["encryption", encryptionSchemes],
        ],
        content: methods.join(" "),
      },
      hexToBytes(sk),
    );
    // No success log: this now runs every 2 minutes per pubkey, so a "published"
    // line each time is pure noise. Only the failure paths below log.
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (await sendEventConfirmed(info)) return true;
      warn(`nwc 13194 publish not confirmed (attempt ${attempt})`, pk);
      await sleep(1000);
    }
    err("nwc failed to publish 13194 info event after retries", pk);
    return false;
  }

  // Send an event to strfry over a fresh socket and resolve true once the relay
  // replies OK=accepted. Independent of the long-lived NWC socket, whose
  // fire-and-forget send proved unreliable for the persisted info event.
  function sendEventConfirmed(ev: any, timeoutMs = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      let ws: WebSocket;
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        try { ws.close(); } catch (_) {}
        resolve(ok);
      };
      try {
        ws = new WebSocket("ws://sf:7777");
      } catch (_) {
        return resolve(false);
      }
      ws.onopen = () => ws.send(JSON.stringify(["EVENT", ev]));
      ws.onmessage = (e: any) => {
        try {
          const m = JSON.parse(e.data);
          if (m[0] === "OK" && m[1] === ev.id) finish(!!m[2]);
        } catch (_) {}
      };
      ws.onerror = () => finish(false);
      setTimeout(() => finish(false), timeoutMs);
    });
  }

  // The kind 13194 info event (NWC capability advertisement) is REPLACEABLE, so
  // it's meant to persist on the relay. NWC clients (Alby Go, Lightning Piggies,
  // etc.) fetch it before they'll talk to the wallet — without it they report
  // "no info event" and show an unknown balance.
  //
  // We used to query the relay and publish only the missing pubkeys, but the
  // stored event kept vanishing between checks (cause never pinned down), which
  // left clients broken until the next hourly check. Republishing both server
  // info events unconditionally on a short interval is cheap (a replaceable
  // event, so it just overwrites in place) and self-heals immediately.
  // publishInfo() uses its own short-lived socket, so this works regardless of
  // the long-lived nwc socket's state.
  function ensureInfo() {
    publishInfo(serverPubkey, serverSecret);
    publishInfo(serverPubkey2, serverSecret2);
  }

  function connect() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (infoCheckInterval) clearInterval(infoCheckInterval);
    r = new Relay("ws://sf:7777", { reconnect: false });

    r.on("open", async (_) => {
      l("nwc connected to strfry");

      // Periodically check if connection is alive
      heartbeatInterval = setInterval(() => {
        try {
          if (!r?.ws || r.ws.readyState !== 1) {
            warn("nwc heartbeat: connection dead, reconnecting");
            clearInterval(heartbeatInterval);
            try { r.close(); } catch (_) {}
            setTimeout(connect, 1000);
          }
        } catch (_) {
          warn("nwc heartbeat: error, reconnecting");
          clearInterval(heartbeatInterval);
          setTimeout(connect, 1000);
        }
      }, 30000);
      r.subscribe("nwc", { kinds: [23194], "#p": [serverPubkey, serverPubkey2], since: Math.floor(Date.now() / 1000) - nwcEventMaxAgeSeconds });

      // Publish the 13194 info events immediately, then keep republishing every
      // 2 minutes so a vanished event is never missing for long.
      ensureInfo();
      infoCheckInterval = setInterval(ensureInfo, 2 * 60 * 1000);
    });


    r.on("close", () => {
      warn("nwc strfry connection lost, reconnecting in 5s");
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (infoCheckInterval) clearInterval(infoCheckInterval);
      setTimeout(connect, 5000);
    });

    r.on("error", () => {});

    r.on("event", async (sub, ev) => {
    try {
      if (sub !== "nwc") return;
      const now = Math.floor(Date.now() / 1000);
      // Reject events outside the accepted window in BOTH directions. Old events
      // are stale; future-dated ones (beyond a small skew) could otherwise be
      // replayed indefinitely once a time-bounded dedup entry expired.
      if (ev.created_at) {
        if (now - ev.created_at > nwcEventMaxAgeSeconds) return;
        if (ev.created_at - now > nwcClockSkewSeconds) return;
      }
      // Atomic dedup claim. SET NX is a single-command check-and-set, so two
      // concurrent deliveries of the same signed event cannot both pass — the
      // previous zScore-then-(unawaited)-zAdd let duplicate relay deliveries each
      // reach handle() and pay twice. The claim outlives the accepted age window
      // so a future-dated event can't be replayed after it would have expired.
      if (
        !(await db.set(`${handledKey}:${ev.id}`, "1", {
          NX: true,
          EX: 2 * nwcEventMaxAgeSeconds,
        }))
      )
        return;

      let { content, pubkey } = ev;
      const pk = ev.tags.find((t) => t[0] === "p")[1];
      const sk = serverKeys[pk];
      // Clients mark nip44 requests with an `encryption` tag; absence means
      // legacy nip04 (NIP-47). Replies must use the same scheme.
      const scheme =
        ev.tags.find((t) => t[0] === "encryption")?.[1] === "nip44_v2"
          ? "nip44_v2"
          : "nip04";
      const { params, method } = JSON.parse(
        await decryptPayload(scheme, sk, pubkey, content),
      );

      // Helper: send a 23195 reply (used for both results and errors). Pulled
      // up so the rate-limit path can reply instead of dropping silently.
      const reply = async (payloadObj: any) => {
        const enc = await encryptPayload(
          scheme,
          sk,
          pubkey,
          JSON.stringify(payloadObj),
        );
        const signed = await finalizeEvent(
          {
            created_at: Math.floor(Date.now() / 1000),
            kind: 23195,
            pubkey: serverPubkey,
            tags: [["p", pubkey], ["e", ev.id], ["encryption", scheme]],
            content: enc,
          } as UnsignedEvent,
          hexToBytes(sk),
        );
        r.send(["EVENT", signed]);
      };

      // Per-pubkey rate limiting. Over-limit requests get a NIP-47 RATE_LIMITED
      // error reply (not a silent drop) so the client can distinguish throttling
      // from a lost reply and back off.
      const times = nwcRequestTimes.get(ev.pubkey) || [];
      const cutoff = Date.now() - nwcRateWindow;
      const recent = times.filter((t) => t > cutoff);
      if (recent.length >= nwcRateLimit) {
        // The event is already claimed above, so it won't be reprocessed.
        await reply({
          result_type: method,
          error: { code: "RATE_LIMITED", message: "Too many requests, slow down" },
        });
        return;
      }
      recent.push(Date.now());
      nwcRequestTimes.set(ev.pubkey, recent);

      // console.log("nwc", method, params, pubkey);

      if (!methods.includes(method)) return;

      try {
        const app = await g(`app:${pubkey}`);
        if (!app) fail("pubkey not found");
        const user = await g(`user:${app.uid}`);
        if (!user) fail("user not found");

        // Serialize budget-affecting methods per app so the budget check and the
        // resulting spend can't interleave with a concurrent request on the same
        // connection. Read-only methods run without contending for the lock.
        const run = () => handle(method, params, ev, app, user);
        const result = budgetedMethods.has(method)
          ? await withBudgetLock(app.pubkey, run)
          : await run();
        // A handler returning nothing (e.g. pay_invoice that couldn't confirm in
        // time) must still produce a reply, or the client hangs forever waiting.
        if (result === undefined || result === null) {
          await reply({
            result_type: method,
            error: { code: "INTERNAL", message: "No response from handler" },
          });
        } else {
          await reply({ result_type: method, ...result });
        }
      } catch (e) {
        // Stale client state (deleted app or migrated user) is not a server fault — don't log.
        if (e.message === "pubkey not found" || e.message === "user not found") return;
        err("problem with nwc", pubkey, method, e.message);
        // Still reply so the client isn't left hanging on the failure.
        try {
          await reply({
            result_type: method,
            error: { code: "INTERNAL", message: e.message },
          });
        } catch (_) {}
      }
    } catch (e) {
      err("problem with nwc event", e.message);
    }
  });
  }

  connect();
};

// Pull the single lightning instruction out of a BIP-321 payment string for
// the nwc `pay` method (nwc#2): a bitcoin: URI (preferring lno= over
// lightning=), a lightning: URI, or a bare bolt11/bolt12 string. Returns
// { instruction } or { error } (a ready-to-send NIP-47 error payload).
const noInstruction = error({
  code: "UNSUPPORTED_PAYMENT_INSTRUCTION",
  message: "No lightning instruction found (bolt11 or bolt12 required)",
});
const parseInstruction = (payment) => {
  if (typeof payment !== "string") return noInstruction;
  let s = payment.replace(/\s/g, "");
  const lower = s.toLowerCase();
  if (lower.startsWith("lightning:")) {
    s = s.slice("lightning:".length);
  } else if (lower.startsWith("bitcoin:")) {
    const i = s.indexOf("?");
    if (i === -1) return noInstruction;
    let lno;
    let bolt11;
    // BIP-321 keys are case-insensitive and may repeat; first one wins
    for (const [k, v] of new URLSearchParams(s.slice(i + 1))) {
      const key = k.toLowerCase();
      // BIP-321: a req- parameter the wallet doesn't understand invalidates
      // the whole URI. We support none — including req-pop, since we can't
      // open a proof-of-payment callback — so any req- key is a rejection.
      // A plain (optional) pop is skippable and falls through harmlessly.
      if (key.startsWith("req-")) {
        return error({
          code: "BAD_REQUEST",
          message: `Unsupported required BIP-321 parameter: ${key}`,
        });
      }
      if (key === "lno") lno ||= v;
      else if (key === "lightning") bolt11 ||= v;
    }
    s = lno || bolt11;
    if (!s) return noInstruction;
  }
  s = s.toLowerCase();
  return s.startsWith("ln") ? { instruction: s } : noInstruction;
};

// Network matching for the nwc `pay` method: the spec requires rejecting a
// payment instruction for a different Bitcoin network BEFORE paying (error
// code UNSUPPORTED_NETWORK) rather than letting xpay fail after the debit.
// bolt11 encodes the network in its bech32 prefix (decode's `currency`);
// bolt12 carries BOLT chain_hashes (genesis hash, internal byte order), with
// absence meaning mainnet. Keyed by CLN getinfo's `network` name.
const bolt11Prefixes = {
  bitcoin: "bc",
  testnet: "tb",
  signet: "tbs",
  regtest: "bcrt",
};
const chainHashes = {
  bitcoin: "6fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d6190000000000",
  testnet: "43497fd7f826957108f4a30fd9cec3aeba79972084e90ead01ea330900000000",
  signet: "f61eee3b63a380a477a063af32b2bbc97c9ff9f01f2c4225e973988108000000",
  regtest: "06226e46111a0b59caaf126043eb5bbf28c34f3a5e332a1fc7b2b73cf188910f",
};
const matchesNetwork = (decoded, network) => {
  if (decoded.type === "bolt11 invoice")
    return decoded.currency === bolt11Prefixes[network];
  const ours = chainHashes[network];
  if (decoded.type === "bolt12 offer")
    return decoded.offer_chains
      ? decoded.offer_chains.includes(ours)
      : network === "bitcoin";
  const chain = decoded.invreq_chain || chainHashes.bitcoin;
  return chain === ours;
};

// CLN v26.06's experimental `createproof` RPC produces the lnp payer proof
// that NIP-177 zap receipts (kind 9736) embed. The default proof OMITS
// invreq_payer_note, which NIP-177 verification requires disclosed (it binds
// the payment to the zap intent) — and passing `include` REPLACES the default
// disclosure set, so invoice_amount must be re-listed alongside it or the
// amount gets hidden too. Feature-detected through the generic call() — on
// older nodes this errors and we omit the proof, which the nwc `pay` spec
// allows.
const createPayerProof = async (
  invstring: string,
  hasPayerNote: boolean = false,
) => {
  try {
    const r = await ln.call("createproof", {
      invstring,
      ...(hasPayerNote && { include: ["invreq_payer_note", "invoice_amount"] }),
    });
    return r?.proofs?.[0]?.bolt12;
  } catch (e) {
    return undefined;
  }
};

// Connection validity + spending budget for an NWC app, shared by pay_invoice
// and pay. Returns a NIP-47 error payload, or null when the spend is allowed.
const checkBudget = async (app, amount) => {
  const { max_amount, budget_renewal, pubkey, created } = app;

  if (!created) {
    return error({
      code: "UNAUTHORIZED",
      message: `This NWC connection is no longer valid please create a new one at https://coinos.io/settings/nostr`,
    });
  }

  const periods = {
    daily: 60 * 60 * 24 * 1000,
    weekly: 60 * 60 * 24 * 7 * 1000,
    monthly: 60 * 60 * 24 * 30 * 1000,
    yearly: 60 * 60 * 24 * 365 * 1000,
    never: 60 * 60 * 24 * 365 * 10 * 1000,
  };

  const pids = await db.lRange(`${pubkey}:payments`, 0, -1);
  let payments = await Promise.all(pids.map((pid) => gf(`payment:${pid}`)));
  payments = payments.filter(
    (p) => p?.created > Date.now() - periods[budget_renewal],
  );

  const spent = payments.reduce(
    (a, b) =>
      a +
      (Math.abs(Number.parseInt(b.amount || 0)) +
        Number.parseInt(b.tip || 0) +
        Number.parseInt(b.fee || 0) +
        Number.parseInt(b.ourfee || 0)),
    0,
  );

  if (max_amount > 0 && spent + amount > max_amount) {
    return error({
      code: "QUOTA_EXCEEDED",
      message: `Budget exceeded: ${spent + amount} of ${max_amount}`,
    });
  }

  return null;
};

const handle = (method, params, ev, app, user) =>
  ({
    async pay_invoice() {
      const { invoice: pr, metadata, amount: reqAmountMsat } = params;
      const { amount_msat, payee } = await ln.decode(pr);
      const { id } = await ln.getinfo();
      // For an amountless bolt11, the invoice carries no amount — NIP-47 lets the
      // client specify it in the request's `amount` field (msat). Fall back to
      // that so amountless invoices aren't rejected with "Invalid amount"
      // (issue #83). Invoice amount takes precedence when present.
      const amountMsat = amount_msat || reqAmountMsat;
      if (!amountMsat) {
        return error({
          code: "OTHER",
          message:
            "Amountless invoice requires an amount; specify amount (msat) in the request",
        });
      }
      const amount = Math.round(amountMsat / 1000);
      const { max_fee, pubkey } = app;

      const budgetError = await checkBudget(app, amount);
      if (budgetError) return budgetError;

      if (payee === id) {
        const invoice = await getInvoice(pr);
        const recipient = await g(`user:${invoice.uid}`);

        if (recipient?.username !== "mint") {
          const { id: pid } = await sendInternal({
            amount,
            invoice,
            recipient,
            sender: user,
          });

          const preimage = pid;
          if (pubkey !== user.pubkey) await db.lPush(`${pubkey}:payments`, pid);

          if (invoice.memo?.includes("9734")) {
            const { invoices } = await ln.listinvoices({ invstring: pr });
            const inv = invoices[0];
            inv.payment_preimage = preimage;
            inv.paid_at = Math.floor(Date.now() / 1000);
            try {
              await handleZap(inv, user.pubkey);
            } catch (e) {
              console.log("zap receipt failed", e);
            }
          }

          return result({ preimage });
        }
      }

      try {
        // sendLightning runs xpay to completion and finalize() sets p.ref to the
        // preimage on success, so the returned record already carries it — no
        // need to poll listpays and race a 20s timeout (the old loop returned a
        // misleading "Payment timed out" error on slow routes even though the
        // payment had settled; see issue #80).
        const p = await sendLightning({
          amount,
          fee: max_fee || Math.round(amount * 0.01),
          user,
          pr,
          memo: JSON.stringify(metadata),
        });

        await db.lPush(`${pubkey}:payments`, p.id);

        if (p.ref) return result({ preimage: p.ref });

        // Fallback: ref missing (shouldn't normally happen) — confirm via
        // listpays before giving up, with a longer window than before.
        for (let i = 0; i < 30; i++) {
          const { pays } = await ln.listpays(pr);
          const done = pays.find((x) => x.status === "complete");
          if (done?.preimage) return result({ preimage: done.preimage });
          if (pays.length && pays.every((x) => x.status === "failed"))
            return error({ code: "PAYMENT_FAILED", message: "Payment failed" });
          await sleep(2000);
        }
      } catch (e) {
        return error({ code: "PAYMENT_FAILED", message: e.message });
      }

      // Still in flight after the fallback window: the payment may yet settle.
      // Tell the client explicitly rather than implying success or hard failure.
      return error({
        code: "INTERNAL",
        message: "Payment still in flight; check status with lookup_invoice",
      });
    },

    // nwc#2 generalized payment: BIP-321 URI carrying a bolt11 invoice or a
    // bolt12 offer/invoice. This is what Amethyst v1.13+ uses for bolt12 zaps —
    // payer_note carries the nostr:nip177:<intent-id> binding and the client
    // builds the kind 9736 receipt from the returned preimage/payer_proof.
    async pay() {
      const { payment, amount: reqAmountMsat, payer_note, metadata } = params;
      const { pubkey } = app;

      const parsed = parseInstruction(payment);
      if (parsed.error) return parsed;
      const pr = parsed.instruction;

      let decoded;
      try {
        decoded = await ln.decode(pr);
        if (decoded.valid === false) throw new Error("invalid");
      } catch (e) {
        return error({
          code: "BAD_REQUEST",
          message: "Failed to decode payment instruction",
        });
      }

      const { network } = await ln.getinfo();
      if (!matchesNetwork(decoded, network)) {
        return error({
          code: "UNSUPPORTED_NETWORK",
          message: "Payment instruction is for a different Bitcoin network",
        });
      }

      const instruction_type = decoded.type.includes("bolt12")
        ? "bolt12"
        : "bolt11";

      // payer_note rides in a bolt12 invoice request's invreq_payer_note;
      // bolt11 has no payer-message field, and the spec requires delivering
      // the note or rejecting before payment — never silently dropping it
      if (payer_note && instruction_type !== "bolt12") {
        return error({
          code: "BAD_REQUEST",
          message: "payer_note requires a bolt12 payment instruction",
        });
      }

      const instructionAmountMsat =
        decoded.type === "bolt12 offer"
          ? decoded.offer_amount_msat
          : instruction_type === "bolt12"
            ? decoded.invoice_amount_msat
            : decoded.amount_msat;

      if (
        reqAmountMsat !== undefined &&
        reqAmountMsat !== null &&
        (!Number.isFinite(Number(reqAmountMsat)) || Number(reqAmountMsat) <= 0)
      ) {
        return error({ code: "BAD_REQUEST", message: "Invalid amount" });
      }
      if (
        reqAmountMsat &&
        instructionAmountMsat &&
        Number(reqAmountMsat) !== Number(instructionAmountMsat)
      ) {
        return error({
          code: "BAD_REQUEST",
          message: `Requested amount conflicts with the instruction amount (${instructionAmountMsat} msat)`,
        });
      }

      const amountMsat = instructionAmountMsat || reqAmountMsat;
      if (!amountMsat) {
        return error({
          code: "BAD_REQUEST",
          message:
            "Amountless payment instruction requires an amount (msat) in the request",
        });
      }
      const amount = Math.round(amountMsat / 1000);

      const budgetError = await checkBudget(app, amount);
      if (budgetError) return budgetError;

      const created_at = Math.floor(Date.now() / 1000);

      // Recipient is a coinos user (their invoice or standing offer is ours):
      // settle internally, same as pay_invoice does
      const invoice = await getInvoice(pr);
      if (invoice) {
        const recipient = await g(`user:${invoice.uid}`);

        if (recipient?.username !== "mint") {
          // Internal settlement never builds a bolt12 invoice request, so the
          // spec's deliver-or-reject rule for payer_note is met by handing the
          // note to the recipient as the payment memo (bolt11 + payer_note was
          // already rejected above)
          const { id: pid } = await sendInternal({
            amount,
            invoice,
            memo: payer_note,
            recipient,
            sender: user,
          });

          if (pubkey !== user.pubkey) await db.lPush(`${pubkey}:payments`, pid);

          if (invoice.memo?.includes("9734")) {
            const { invoices } = await ln.listinvoices({ invstring: pr });
            const inv = invoices[0];
            if (inv) {
              inv.payment_preimage = pid;
              inv.paid_at = created_at;
              try {
                await handleZap(inv, user.pubkey);
              } catch (e) {
                console.log("zap receipt failed", e);
              }
            }
          }

          // Internal settlement never touches CLN, so there's no real
          // preimage or payer proof to hand back
          return result({
            transaction_id: pid,
            state: "settled",
            instruction_type,
            amount: amountMsat,
            fees_paid: 0,
            created_at,
            settled_at: Math.floor(Date.now() / 1000),
          });
        }
      }

      try {
        const p = await sendLightning({
          amount,
          fee: app.max_fee || Math.round(amount * 0.01),
          user,
          pr,
          memo: metadata ? JSON.stringify(metadata) : undefined,
          payerNote: payer_note,
        });

        await db.lPush(`${pubkey}:payments`, p.id);

        const preimage = p.ref;
        if (!preimage) {
          return result({
            transaction_id: p.id,
            state: "pending",
            instruction_type,
            amount: amountMsat,
            fees_paid: 0,
            created_at,
          });
        }

        return result({
          transaction_id: p.id,
          state: "settled",
          instruction_type,
          amount: amountMsat,
          fees_paid: (p.fee || 0) * 1000,
          payment_hash: bytesToHex(sha256(hexToBytes(preimage))),
          preimage,
          // p.hash is the invoice actually paid (for an offer, the bolt12
          // invoice fetched from it)
          payer_proof:
            instruction_type === "bolt12"
              ? await createPayerProof(p.hash, !!payer_note)
              : undefined,
          created_at,
          settled_at: Math.floor(Date.now() / 1000),
        });
      } catch (e) {
        return error({ code: "PAYMENT_FAILED", message: e.message });
      }
    },

    // nwc#2 counterpart to pay: hand back a BIP-321 URI combining a fresh
    // bolt11 invoice with the user's standing bolt12 offer
    async receive() {
      const { amount, description } = params;

      try {
        const invoice = await generate({
          invoice: {
            amount: amount ? Math.round(amount / 1000) : 0,
            type: "lightning",
            memo: description,
          },
          user,
        });

        const qs = new URLSearchParams();
        qs.set("lightning", invoice.hash);
        try {
          // The spec requires the description in EVERY instruction that
          // supports one (offers do), and an amount shouldn't come back as an
          // amountless lno — so an amounted or described receive mints a
          // matching per-request offer; the reusable standing offer only fits
          // the blank request. On failure (e.g. an identical offer already
          // registered to another user) the lno is omitted rather than
          // substituting one with the wrong description/amount.
          const offer =
            amount || description
              ? await generate({
                  invoice: {
                    type: "bolt12",
                    amount: amount ? Math.round(amount / 1000) : 0,
                    memo: description,
                  },
                  user,
                })
              : await getUserOffer(user);
          if (offer?.hash) qs.set("lno", offer.hash);
        } catch (e) {
          warn("failed to include offer in receive", e.message);
        }

        return result({
          bip321: `bitcoin:?${qs.toString()}`,
          transaction_id: invoice.id,
        });
      } catch (e) {
        return error({ code: "BAD_REQUEST", message: e.message });
      }
    },

    async pay_keysend() {
      const { amount: amount_msat, pubkey, tlv_records } = params;
      const amount = Math.round(amount_msat / 1000);
      const extratlvs = {};

      // convert tlv_records to the extratlvs format
      // tlv_records: [{ type: 1, value: "asdf" }]
      // extratlvs: { "1": "asdf" }
      if (tlv_records && tlv_records.length) {
        for (const record of tlv_records) {
          extratlvs[record.type.toString()] = record.value;
        }
      }

      // Keysend spends the same custodial balance as pay_invoice, so it must be
      // subject to the same budget — otherwise a budget-limited connection string
      // is a full-drain credential. It also left no `${app.pubkey}:payments`
      // entry, so subsequent budgeted calls under-counted the spend.
      const budgetError = await checkBudget(app, amount);
      if (budgetError) return budgetError;

      try {
        const { payment_hash } = await sendKeysend({
          hash: ev.id,
          amount,
          pubkey,
          user,
          extratlvs,
          fee: app.max_fee,
        });

        // Record the debit against the app budget. debit() stored the payment id
        // under the keysend label (= ev.id); resolve and push it so checkBudget
        // counts this spend going forward.
        const pid = await g(`payment:${ev.id}`);
        if (pid) await db.lPush(`${app.pubkey}:payments`, pid);

        for (let i = 0; i < 10; i++) {
          const { pays } = await ln.listpays({ payment_hash });
          const p = pays.find((p) => p.status === "complete");
          if (p) {
            const { preimage } = p;
            return result({ preimage });
          }
          await sleep(2000);
        }

        return error({ code: "INTERNAL", message: "Payment timed out" });
      } catch (e) {
        return error({ code: "INTERNAL", message: "Keysend payment failed" });
      }
    },

    async get_info() {
      const { alias, blockheight, color, id, network } = await ln.getinfo();

      return result({
        alias,
        block_hash: await bc.getBlockHash(blockheight),
        block_height: blockheight,
        color,
        pubkey: id,
        // CLN calls mainnet "bitcoin"; NIP-47 clients expect "mainnet"
        network: network === "bitcoin" ? "mainnet" : network,
        methods,
        notifications: ["payment_received", "payment_sent"],
      });
    },

    async get_balance() {
      let balance = await g(`balance:${user.id}`);
      balance *= 1000;
      return result({ balance });
    },

    async make_invoice() {
      const { amount, description, description_hash, expiry } = params;
      // l("nwc make_invoice", user.username);

      const invoice = {
        amount: Math.round(amount / 1000),
        type: "lightning",
        memo: description,
        expiry,
      };

      const { hash, created, paymentHash } = await generate({ invoice, user });

      // generate() stores `created` in milliseconds (Date.now()), but NWC
      // timestamps are Unix SECONDS (NIP-47). Returning ms here produced an
      // expires_at ~1.78e12 that overflowed clients' date parsers — e.g.
      // ptcpay's .NET DateTimeOffset (issue #84: "Valid values are between
      // -62135596800 and 253402300799"). Convert to seconds.
      const created_at = Math.floor(created / 1000);

      return result({
        type: "incoming",
        invoice: hash,
        description,
        description_hash,
        amount,
        created_at,
        expires_at: created_at + expiry,
        fees_paid: 0,
        payment_hash: paymentHash,
        metadata: {},
      });
    },

    async lookup_invoice() {
      let { invoice, payment_hash } = params;

      const { invoices } = await ln.listinvoices({
        invstring: invoice,
        payment_hash,
      });

      if (invoices.length) {
        const {
          amount_received_msat: amount,
          description,
          expires_at,
          paid_at: settled_at,
        } = invoices[0];

        ({ bolt11: invoice, payment_hash } = invoices[0]);
        const { preimage, settled } = await getInvoice(invoice);

        return result({
          type: "incoming",
          invoice,
          description,
          preimage,
          payment_hash,
          amount,
          fees_paid: 0,
          created_at: expires_at - week,
          expires_at,
          settled_at: settled_at || Math.round(settled / 1000),
          state: settled ? "settled" : "pending",
          status: settled ? "paid" : "pending",
        });
      }

      const { pays } = await ln.listpays({ bolt11: invoice, payment_hash });

      if (!pays.length)
        return error({ code: "NOT_FOUND", message: "Invoice not found" });

      const {
        amount_msat: amount,
        amount_sent_msat,
        created_at,
        preimage,
        completed_at: settled_at,
      } = pays[0];

      ({ bolt11: invoice, payment_hash } = pays[0]);

      return result({
        type: "outgoing",
        invoice,
        preimage,
        payment_hash,
        amount,
        fees_paid: amount_sent_msat - amount,
        created_at,
        settled_at,
      });
    },

    async list_transactions() {
      const { from, until, limit = 10, offset = 0, type } = params;

      const listKey = `${user.id}:payments`;
      const main = (await db.lRange(listKey, 0, -1)) || [];
      const archived = (await archive.lRange(listKey, 0, -1)) || [];
      const payments = [...new Set([...main, ...archived])];

      let transactions = [];
      for (const pid of payments) {
        const p = await gf(`payment:${pid}`);
        if (!p) continue;
        if (p.revertedDuplicate) continue;
        const created_at = Math.floor(p.created / 1000);
        if (created_at < from || created_at > until) continue;
        if (p.amount < 0 && type === "incoming") continue;
        if (p.amount > 0 && type === "outgoing") continue;

        let payment_hash = p.payment_hash || pid;
        if (p.type === "lightning") {
          try {
            if (p.amount > 0) {
              const { invoices } = await ln.listinvoices({ invstring: p.hash });
              payment_hash ||= invoices[0].payment_hash;
            } else {
              const { pays } = await ln.listpays({ bolt11: p.hash });
              payment_hash ||= pays[0].payment_hash;
            }
          } catch (e) {}
        }

        transactions.push({
          type: p.amount > 0 ? "incoming" : "outgoing",
          invoice: p.hash,
          description: p.memo,
          preimage: p.ref,
          payment_hash,
          amount: (Math.abs(p.amount) + (p.tip || 0)) * 1000,
          fees_paid: (p?.fee || 0) * 1000,
          created_at,
          expires_at: created_at + week,
          settled_at: p.amount > 0 ? created_at : undefined,
          state: "settled",
          metadata: {},
        });
      }

      transactions = transactions.slice(offset, offset + limit);
      return result({ transactions });
    },
  })[method](params);
