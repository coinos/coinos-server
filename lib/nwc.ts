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
const handledKey = "handled:nwc";
const handledMaxSize = 200000;

// Per-pubkey rate limiting for NWC requests. Raised 5 -> 60/min: normal client
// usage (a balance check or two + a payment + a few lookup_invoice reconciles)
// blows past 5 trivially, and over-limit requests were dropped SILENTLY with no
// reply — indistinguishable from lost replies. 60/min (1/s avg) is ample
// headroom for interactive use while still capping abuse.
const nwcRateLimit = 60; // max requests per minute per pubkey
const nwcRateWindow = 60 * 1000; // 1 minute in ms
const nwcRequestTimes: Map<string, number[]> = new Map();

export default () => {
  let r: any;
  let heartbeatInterval: any;
  let infoCheckInterval: any;

  // Tracks which server pubkeys already have their kind 13194 info event on the
  // relay, populated by the existence query in ensureInfo() below.
  const infoSeen = new Set<string>();

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
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (await sendEventConfirmed(info)) {
        l("nwc published 13194 info event", pk);
        return true;
      }
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
  // it's meant to be published once and persist on the relay. NWC clients (Alby
  // Go, Lightning Piggies, etc.) fetch it before they'll talk to the wallet —
  // without it they report "no info event" and show an unknown balance.
  //
  // Rather than blindly republishing, query the relay on connect and publish
  // only the pubkeys whose info event is missing. This is normally a no-op, but
  // self-heals the case where the event went missing (e.g. the strfry restart on
  // 2026-05-29 that left clients broken for days). The "infocheck" subscription
  // is handled by the event/eose branches below.
  function ensureInfo() {
    if (!r?.ws || r.ws.readyState !== 1) return;
    infoSeen.clear();
    r.subscribe("infocheck", {
      kinds: [13194],
      authors: [serverPubkey, serverPubkey2],
    });
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

      // Verify the 13194 info events exist on the relay, publish any missing.
      ensureInfo();

      // Re-check hourly so a relay restart that leaves our socket intact (or any
      // other cause of the info event going missing) self-heals without waiting
      // for the next app reconnect.
      infoCheckInterval = setInterval(ensureInfo, 60 * 60 * 1000);
    });

    r.on("eose", (sub) => {
      if (sub !== "infocheck") return;
      for (const [pk, sk] of [
        [serverPubkey, serverSecret],
        [serverPubkey2, serverSecret2],
      ]) {
        if (!infoSeen.has(pk)) publishInfo(pk, sk);
      }
      try { r.unsubscribe("infocheck"); } catch (_) {}
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
      if (sub === "infocheck") {
        // Only count the stored info event as present if it's CURRENT —
        // otherwise a stale replaceable event (old method list, missing
        // encryption tag) would never get refreshed, since we only publish
        // the ones not "seen".
        if (ev.kind === 13194) {
          const current =
            ev.content === methods.join(" ") &&
            ev.tags?.some(
              (t) => t[0] === "encryption" && t[1] === encryptionSchemes,
            );
          if (current) infoSeen.add(ev.pubkey);
        }
        return;
      }
      if (sub !== "nwc") return;
      const now = Math.floor(Date.now() / 1000);
      if (ev.created_at && now - ev.created_at > nwcEventMaxAgeSeconds) return;
      if (await db.zScore(handledKey, ev.id)) return;

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
        db.zAdd(handledKey, { score: now, value: ev.id });
        await reply({
          result_type: method,
          error: { code: "RATE_LIMITED", message: "Too many requests, slow down" },
        });
        return;
      }
      recent.push(Date.now());
      nwcRequestTimes.set(ev.pubkey, recent);

      db.zAdd(handledKey, { score: now, value: ev.id });
      db.zRemRangeByScore(handledKey, 0, now - nwcEventMaxAgeSeconds);
      const size = await db.zCard(handledKey);
      if (size > handledMaxSize) {
        await db.zRemRangeByRank(handledKey, 0, size - handledMaxSize - 1);
      }

      // console.log("nwc", method, params, pubkey);

      if (!methods.includes(method)) return;

      try {
        const app = await g(`app:${pubkey}`);
        if (!app) fail("pubkey not found");
        const user = await g(`user:${app.uid}`);
        if (!user) fail("user not found");

        const result = await handle(method, params, ev, app, user);
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
// lightning=), a lightning: URI, or a bare bolt11/bolt12 string.
const parseInstruction = (payment) => {
  if (typeof payment !== "string") return null;
  let s = payment.replace(/\s/g, "");
  const lower = s.toLowerCase();
  if (lower.startsWith("lightning:")) {
    s = s.slice("lightning:".length);
  } else if (lower.startsWith("bitcoin:")) {
    const i = s.indexOf("?");
    if (i === -1) return null;
    let lno;
    let bolt11;
    // BIP-321 keys are case-insensitive and may repeat; first one wins
    for (const [k, v] of new URLSearchParams(s.slice(i + 1))) {
      const key = k.toLowerCase();
      if (key === "lno") lno ||= v;
      else if (key === "lightning") bolt11 ||= v;
    }
    s = lno || bolt11;
    if (!s) return null;
  }
  s = s.toLowerCase();
  return s.startsWith("ln") ? s : null;
};

// CLN v26.06 adds an experimental `createproof` RPC producing the lnp payer
// proof that NIP-177 zap receipts (kind 9736) embed: createproof(invstring,
// [note], [include]) -> { proofs: [{ bolt12: "lnp..." }] }. Feature-detect
// through the generic call() — on older nodes (current: v25.12) this errors
// and we omit the proof, which the nwc `pay` spec allows. The proof format is
// still draft; once 26.06 is deployed, check whether NIP-177's required
// fields (invreq_payer_note, invoice_amount) need an explicit `include` list.
const createPayerProof = async (invstring: string) => {
  try {
    const r = await ln.call("createproof", { invstring });
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

      const pr = parseInstruction(payment);
      if (!pr) {
        return error({
          code: "UNSUPPORTED_PAYMENT_INSTRUCTION",
          message: "No lightning instruction found (bolt11 or bolt12 required)",
        });
      }

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

      const instruction_type = decoded.type.includes("bolt12")
        ? "bolt12"
        : "bolt11";
      const instructionAmountMsat =
        decoded.type === "bolt12 offer"
          ? decoded.offer_amount_msat
          : instruction_type === "bolt12"
            ? decoded.invoice_amount_msat
            : decoded.amount_msat;

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
          const { id: pid } = await sendInternal({
            amount,
            invoice,
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
              ? await createPayerProof(p.hash)
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
          const offer = await getUserOffer(user);
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

      try {
        const { payment_hash } = await sendKeysend({
          hash: ev.id,
          amount,
          pubkey,
          user,
          extratlvs,
        });

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
      const { alias, blockheight, color, id } = await ln.getinfo();

      return result({
        alias,
        block_hash: await bc.getBlockHash(blockheight),
        block_height: blockheight,
        color,
        pubkey: id,
        network: "mainnet",
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
