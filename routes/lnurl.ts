import { db, g, s } from "$lib/db";
import { generate } from "$lib/invoices";
import ln from "$lib/ln";
import { err, warn } from "$lib/logging";
import { serverPubkey } from "$lib/nostr";
import { credit } from "$lib/payments";
import { bail, fail, getInvoice, getUser } from "$lib/utils";
import { bech32 } from "bech32";
import got from "got";
import { v4 } from "uuid";

import { PaymentType } from "$lib/types";

const { URL } = process.env;
const host = URL.split("/").at(-1);

export default {
  async encode(req, res) {
    const {
      query: { address },
    } = req;
    const [name, domain] = address.split("@");
    const url = `https://${domain}/.well-known/lnurlp/${name.toLowerCase().replace(/\s/g,"")}`;

    try {
      const r = await got(url).json();
      if (r.tag !== "payRequest") fail("not an ln address");
    } catch (e) {
      const m = `failed to lookup lightning address ${address}`;
      warn(m);
      return bail(res, m);
    }

    const enc = bech32.encode("lnurl", bech32.toWords(Buffer.from(url)), 20000);
    res.send(enc);
  },

  async decode(req, res) {
    const {
      query: { text },
    } = req;
    try {
      const url = Buffer.from(
        bech32.fromWords(bech32.decode(text, 20000).words),
      ).toString();

      res.send(await got(url).json());
    } catch (e) {
      bail(res, e.message);
    }
  },

  async lnurlp(req, res) {
    const {
      params: { username },
      query: { minSendable = 1000, maxSendable = 100000000000 },
    } = req;
    try {
      const user = await getUser(
        username
          .replace("lightning:", "")
          .replace(/\s/g, "")
          .replace("=", "")
          .toLowerCase(),
      );

      if (!user) fail(`User ${username} not found`);
      const { id: uid } = user;

      const metadata = JSON.stringify([
        ["text/plain", `Paying ${username}@${host}`],
        ["text/identifier", `${username}@${host}`],
      ]);

      const id = v4();
      await s(`lnurl:${id}`, uid);

      res.send({
        allowsNostr: true,
        minSendable,
        maxSendable,
        metadata,
        nostrPubkey: serverPubkey,
        commentAllowed: 512,
        callback: `${URL}/api/lnurl/${id}`,
        tag: "payRequest",
      });
    } catch (e) {
      if (!e.message.includes("found"))
        warn("problem generating lnurlp request", username, e.message);
      bail(res, e.message);
    }
  },

  async lnurl(req, res) {
    const {
      params: { id },
      query: { amount, comment, nostr },
    } = req;
    try {
      const uid = await g(`lnurl:${id}`);
      const user = await getUser(uid);
      if (!user) fail("user not found");
      let { username } = user;
      username = username.replace(/\s/g, "").toLowerCase();

      const memo = comment ?? `Paying ${username}@${host}`;
      let metadata = JSON.stringify([
        ["text/plain", memo],
        ["text/identifier", `${username}@${host}`],
      ]);

      if (nostr) {
        try {
          const event = JSON.parse(decodeURIComponent(nostr));
          // TODO: validate the event
          await s(`zap:${id}`, event);
          metadata = nostr;
        } catch (e) {
          err("problem handling zap", e.message);
        }
      }

      const { id: iid, text: pr } = await generate({
        invoice: {
          amount: Math.round(amount / 1000),
          memo: metadata,
          type: PaymentType.lightning,
        },
        user,
      });

      res.send({ pr, routes: [], verify: `${URL}/api/lnurl/verify/${iid}` });
    } catch (e) {
      bail(res, e.message);
    }
  },

  async verify(req, res) {
    const {
      params: { id },
    } = req;
    const inv = await getInvoice(id);
    if (!inv) return res.send({ status: "ERROR", reason: "Not found" });

    const { hash, received, amount, preimage } = inv;
    const settled = received >= amount;

    res.send({ pr: hash, status: "OK", settled, preimage: preimage || null });
  },

  async withdraw(req, res) {
    try {
      const { pr, k1: id } = req.query;
      const invoice = await getInvoice(pr);
      const { amount_msat } = await ln.decode(pr);
      const amount = Math.ceil(amount_msat / 1000);
      await db.debit(`fund:${id}`, "", amount, 0, 0, 0);
      let p;
      if (invoice) {
        const { hash } = invoice;
        p = await credit({
          hash,
          amount,
          memo: id,
          ref: id,
          type: PaymentType.fund,
        });
      } else {
        await ln.xpay({
          invstring: pr.replace(/\s/g, "").toLowerCase(),
          maxfee: 0,
          retry_for: 10,
        });
        const rates = await g("rates");
        p = {
          id: v4(),
          amount: -amount,
          hash: pr,
          confirmed: true,
          rate: rates.USD,
          currency: "USD",
          type: PaymentType.fund,
          ref: id,
          created: Date.now(),
        };
        await s(`payment:${p.id}`, p);
        await s(`payment:${pr}`, p);
      }

      await db.lPush(`fund:${id}:payments`, p.id);
      res.send({ status: "OK" });
    } catch (e) {
      console.log(e);
      warn("lnurlw failed", e.message);
      res.send({ status: "ERROR", reason: "Withdrawal failed" });
    }
  },
};
