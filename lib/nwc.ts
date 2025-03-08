import config from "$config";
import { db, g } from "$lib/db";
import { generate } from "$lib/invoices";
import ln from "$lib/ln";
import { err, l, warn } from "$lib/logging";
import { handleZap, serverPubkey, serverSecret } from "$lib/nostr";
import { sendInternal, sendKeysend, sendLightning } from "$lib/payments";
import { fail, getInvoice, sleep } from "$lib/utils";
import rpc from "@coinos/rpc";
import { hexToBytes } from "@noble/hashes/utils";
import { Relay } from "nostr";
import { finalizeEvent, nip04 } from "nostr-tools";
import type { UnsignedEvent } from "nostr-tools";

const result = (result) => ({ result });
const error = (error) => ({ error });
const bc = rpc(config.bitcoin);

const methods = [
  "pay_keysend",
  "pay_invoice",
  "get_balance",
  "get_info",
  "make_invoice",
  "lookup_invoice",
  "list_transactions",
];

const week = 7 * 24 * 60 * 60;

export default () => {
  const r = new Relay("ws://sf:7777");

  r.on("open", async (_) => {
    r.subscribe("nwc", { kinds: [23194], "#p": [serverPubkey] });
    const info = await finalizeEvent(
      {
        created_at: Math.floor(Date.now() / 1000),
        kind: 13194,
        tags: [
          ["p", serverPubkey],
          ["notifications", "payment_received payment_sent"],
        ],
        content: methods.join(" "),
      },
      hexToBytes(serverSecret),
    );
    r.send(["EVENT", info]);
  });

  r.on("event", async (sub, ev) => {
    try {
      if (sub !== "nwc") return;
      if (await db.sIsMember("handled", ev.id)) return;
      db.sAdd("handled", ev.id);
      let { content, pubkey } = ev;
      const { params, method } = JSON.parse(
        await nip04.decrypt(serverSecret, pubkey, content),
      );

      // console.log("nwc", method, params, pubkey);

      if (!methods.includes(method)) return;

      try {
        const app = await g(`app:${pubkey}`);
        if (!app) fail("pubkey not found");
        const user = await g(`user:${app.uid}`);

        const result = await handle(method, params, ev, app, user);
        const payload = JSON.stringify({ result_type: method, ...result });
        content = await nip04.encrypt(serverSecret, pubkey, payload);

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

        response = await finalizeEvent(response, hexToBytes(serverSecret));
        r.send(["EVENT", response]);
      } catch (e) {
        err(
          "problem with nwc",
          pubkey,
          method,
          JSON.stringify(params),
          e.message,
        );
      }
    } catch (e) {
      err("problem with nwc", e.message);
    }
  });
};

const handle = (method, params, ev, app, user) =>
  ({
    async pay_invoice() {
      const { invoice: pr } = params;
      const { amount_msat, payee } = await ln.decode(pr);
      const { id } = await ln.getinfo();
      const amount = Math.round(amount_msat / 1000);
      const { max_amount, max_fee, budget_renewal, pubkey, created } = app;

      const periods = {
        daily: 60 * 60 * 24 * 1000,
        weekly: 60 * 60 * 24 * 7 * 1000,
        monthly: 60 * 60 * 24 * 30 * 1000,
        yearly: 60 * 60 * 24 * 365 * 1000,
        never: 60 * 60 * 24 * 365 * 10 * 1000,
      };

      const pids = await db.lRange(`${pubkey}:payments`, 0, -1);
      let payments = await Promise.all(pids.map((pid) => g(`payment:${pid}`)));
      payments = payments.filter(
        (p) => p?.created > Date.now() - periods[budget_renewal],
      );

      const spent = payments.reduce(
        (a, b) =>
          a +
          (Math.abs(parseInt(b.amount || 0)) +
            parseInt(b.tip || 0) +
            parseInt(b.fee || 0) +
            parseInt(b.ourfee || 0)),
        0,
      );

      if (!created) {
        warn(
          "old nwc token",
          pubkey,
          user?.username,
          spent,
          amount,
          max_amount,
        );
        return error({
          code: "UNAUTHORIZED",
          message: `This NWC connection is no longer valid please create a new one at https://coinos.io/settings/nostr`,
        });
      }

      if (max_amount > 0 && spent + amount > max_amount) {
        warn(
          "budget exceeded",
          pubkey,
          user?.username,
          spent,
          amount,
          max_amount,
        );
        return error({
          code: "QUOTA_EXCEEDED",
          message: `Budget exceeded: ${spent + amount} of ${max_amount}`,
        });
      }

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

      const { id: pid } = await sendLightning({
        amount,
        fee: max_fee || Math.round(amount * 0.01),
        user,
        pr,
      });

      await db.lPush(`${pubkey}:payments`, pid);

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

    async pay_keysend() {
      const { amount: amount_msat, pubkey, tlv_records: extratlvs } = params;
      const amount = Math.round(amount_msat / 1000);

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
      l("nwc make_invoice", user.username);

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

      const payments = await db.lRange(`${user.id}:payments`, 0, -1);

      let transactions = [];
      for (const pid of payments) {
        const p = await g(`payment:${pid}`);
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
          amount: (Math.abs(p.amount) + p.tip) * 1000,
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
