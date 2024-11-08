import config from "$config";
import { db, g } from "$lib/db";
import { generate } from "$lib/invoices";
import ln from "$lib/ln";
import { err } from "$lib/logging";
import { handleZap, serverPubkey } from "$lib/nostr";
import { sendInternal, sendLightning } from "$lib/payments";
import { getInvoice, sleep } from "$lib/utils";
import { Relay } from "nostr";
import { finalizeEvent, nip04, nip19 } from "nostr-tools";
import type { UnsignedEvent } from "nostr-tools";

const result = (result) => ({ result });
const error = (error) => ({ error });

const methods = [
  "pay_invoice",
  "get_balance",
  "get_info",
  "make_invoice",
  "lookup_invoice",
  "list_transactions",
];

const week = 7 * 24 * 60 * 60;

export default () => {
  const r = new Relay("ws://strfry:7777");

  r.on("open", (_) => {
    r.subscribe("nwc", { kinds: [23194], "#p": [serverPubkey] });
  });

  r.on("event", async (sub, ev) => {
    try {
      if (sub !== "nwc") return;
      let { content, pubkey } = ev;
      const sk = nip19.decode(config.nostrKey).data as Uint8Array;
      const { params, method } = JSON.parse(
        await nip04.decrypt(sk, pubkey, content),
      );

      if (!methods.includes(method)) return;

      const uid = await g(pubkey);
      const user = await g(`user:${uid}`);

      const result = await handle(method, params, user);
      const payload = JSON.stringify({ result_type: method, ...result });
      content = await nip04.encrypt(sk, pubkey, payload);

      let response: UnsignedEvent = {
        created_at: Math.floor(Date.now() / 1000),
        kind: 23195,
        pubkey: serverPubkey,
        tags: [
          ["p", pubkey],
          ["e", ev.id],
        ],
        content,
      };

      response = await finalizeEvent(response, sk);
      r.send(["EVENT", response]);
    } catch (e) {
      err("problem with nwc", e.message);
    }
  });
};

const handle = (method, params, user) =>
  ({
    async pay_invoice() {
      const { invoice: pr } = params;
      const { amount_msat, payee } = await ln.decode(pr);
      const { id } = await ln.getinfo();
      const amount = Math.round(amount_msat / 1000);

      if (payee === id) {
        const invoice = await getInvoice(pr);
        const recipient = await g(`user:${invoice.uid}`);

        const { id: preimage } = await sendInternal({
          amount,
          invoice,
          recipient,
          sender: user,
        });

        if (invoice.memo.includes("9734")) {
          const { invoices } = await ln.listinvoices({ invstring: pr });
          const inv = invoices[0];
          inv.payment_preimage = preimage;
          inv.paid_at = Math.floor(Date.now() / 1000);
          try {
            await handleZap(inv);
          } catch (e) {
            console.log("zap receipt failed", e);
          }
        }

        return result({ preimage });
      }
      await sendLightning({
        amount,
        maxfee: Math.max(5, Math.round(amount * 0.005)),
        user,
        pr,
      });

      for (let i = 0; i < 10; i++) {
        const { pays } = await ln.listpays(pr);
        const p = pays.find((p) => p.status === "complete");
        if (p) {
          const { preimage } = p;
          return result({ preimage });
        }
        await sleep(2000);
      }

      return error({ code: "INTERNAL", message: "Payment timed out" });
    },

    async get_info() {
      const { alias, blockheight, color } = await ln.getinfo();
      return result({
        alias,
        color,
        pubkey: serverPubkey,
        network: "mainnet",
        block_height: blockheight,
        methods,
      });
    },

    async get_balance() {
      let balance = await g(`balance:${user.id}`);
      balance *= 1000;
      return result({ balance });
    },

    async make_invoice() {
      const { amount, description, description_hash, expiry } = params;

      const invoice = {
        amount: Math.round(amount / 1000),
        type: "lightning",
        memo: description,
        expiry,
      };

      const { hash, created: created_at } = await generate({ invoice, user });

      return result({
        type: "incoming",
        invoice: hash,
        description,
        description_hash,
        amount,
        created_at,
        expires_at: created_at + expiry,
        metadata: {},
      });
    },

    async lookup_invoice() {
      const { invoice, payment_hash } = params;

      const { invoices } = await ln.listinvoices({
        invstring: invoice,
        payment_hash,
      });

      if (invoices.length) {
        const {
          amount_received_msat: amount,
          description,
          expires_at,
          preimage,
          paid_at: settled_at,
        } = invoices[0];

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
          settled_at,
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

      const payments = await db.lRange(`${user.id}:payments`, 0, -1);

      let transactions = [];
      for (const pid of payments) {
        const p = await g(`payment:${pid}`);
        if (p.created < from || p.created > until) continue;
        if (p.amount < 0 && type === "incoming") continue;
        if (p.amount > 0 && type === "outgoing") continue;

        const { payment_hash } =
          p.type === "lightning"
            ? p.amount > 0
              ? await ln.listinvoices({ invstring: p.hash })
              : await ln.listpays({ bolt11: p.hash })
            : p.id;

        const created_at = Math.floor(p.created / 1000);

        transactions.push({
          type: p.amount > 0 ? "incoming" : "outgoing",
          invoice: p.hash,
          description: p.memo,
          preimage: p.ref,
          payment_hash,
          amount: Math.abs(p.amount * 1000),
          fees_paid: p.fee * 1000,
          created_at,
          expires_at: created_at + week,
          settled_at: p.amount > 0 ? created_at : undefined,
          metadata: {},
        });
      }

      transactions = transactions.slice(offset, offset + limit);
      return result({ transactions });
    },
  })[method](params);
