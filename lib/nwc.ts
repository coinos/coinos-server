import config from "$config";
import { err } from "$lib/logging";
import { g } from "$lib/db";
import { Relay } from "nostr";
import { getInvoice, sleep } from "$lib/utils";
import { sendInternal, sendLightning } from "$lib/payments";
import { handleZap, serverPubkey } from "$lib/nostr";
import { nip04, nip19, finalizeEvent } from "nostr-tools";
import type { UnsignedEvent } from "nostr-tools";
import { generate } from "$lib/invoices";
import ln from "$lib/ln";

let result = (result) => ({ result });
let error = (error) => ({ error });

let methods = ["pay_invoice", "get_balance", "get_info", "make_invoice"];

export default () => {
  let r = new Relay("ws://strfry:7777");

  r.on("open", (_) => {
    r.subscribe("nwc", { kinds: [23194], "#p": [serverPubkey] });
  });

  r.on("event", async (sub, ev) => {
    try {
      if (sub !== "nwc") return;
      let { content, pubkey } = ev;
      let sk = nip19.decode(config.nostrKey).data as Uint8Array;
      let { params, method } = JSON.parse(
        await nip04.decrypt(sk, pubkey, content),
      );

      if (!methods.includes(method)) return;

      let uid = await g(pubkey);
      let user = await g(`user:${uid}`);

      let result = await handle(method, params, user);
      let payload = JSON.stringify({ result_type: method, ...result });
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

let handle = (method, params, user) =>
  ({
    async pay_invoice() {
      let { invoice: pr } = params;
      let { amount_msat, payee } = await ln.decode(pr);
      let { id } = await ln.getinfo();
      let amount = Math.round(amount_msat / 1000);

      if (payee === id) {
        let invoice = await getInvoice(pr);
        let recipient = await g(`user:${invoice.uid}`);

        let { id: preimage } = await sendInternal({
          amount,
          invoice,
          recipient,
          sender: user,
        });

        if (invoice.memo.includes("9734")) {
          let { invoices } = await ln.listinvoices({ invstring: pr });
          let inv = invoices[0];
          inv.payment_preimage = preimage;
          inv.paid_at = Math.floor(Date.now() / 1000);
          try {
            await handleZap(inv);
          } catch (e) {
            console.log("zap receipt failed", e);
          }
        }


        return result({ preimage });
      } else {
        await sendLightning({
          amount,
          user,
          pr,
          maxfee: 50,
        });

        for (let i = 0; i < 10; i++) {
          let { pays } = await ln.listpays(pr);
          let p = pays.find((p) => p.status === "complete");
          if (p) {
            let { preimage } = p;
            return result({ preimage });
          }
          await sleep(2000);
        }

        return error({ code: "INTERNAL", message: "Payment timed out" });
      }
    },

    async get_info() {
      let { alias, blockheight, color } = await ln.getinfo();
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
      let { amount, description, description_hash, expiry } = params;

      let invoice = {
        amount: Math.round(amount / 1000),
        type: "lightning",
        memo: description,
        expiry,
      };

      let { hash, created: created_at } = await generate({ invoice, user });

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
  })[method](params);
