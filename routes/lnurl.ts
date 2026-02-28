import { db, g, gf, s } from "$lib/db";
import { generate } from "$lib/invoices";
import { err, warn } from "$lib/logging";
import { serverPubkey2 } from "$lib/nostr";
import { SATS, bail, fail, getInvoice, getUser } from "$lib/utils";
import { bech32 } from "bech32";
import got from "got";
import { v4 } from "uuid";

import { PaymentType } from "$lib/types";

const { URL } = process.env;
const host = URL.split("/").at(-1);
const fiveMinutes = 1000 * 60 * 5;

export default {
  async encode(c) {
    const address = c.req.query("address");
    const [name, domain] = address.split("@");
    const url = `https://${domain}/.well-known/lnurlp/${name.toLowerCase().replace(/\s/g, "")}`;

    try {
      const r = await got(url).json();
      if (r.tag !== "payRequest") fail("not an ln address");
    } catch (e) {
      const m = `failed to lookup lightning address ${address}`;
      warn(m);
      return bail(c, m);
    }

    const enc = bech32.encode("lnurl", bech32.toWords(Buffer.from(url)), 20000);
    return c.json(enc);
  },

  async decode(c) {
    const text = c.req.query("text");
    try {
      const url = Buffer.from(bech32.fromWords(bech32.decode(text, 20000).words)).toString();

      const r = await got(url).json();
      return c.json(r);
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async lnurlp(c) {
    const username = c.req.param("username");
    const minSendable = c.req.query("minSendable") || 1000;
    const maxSendable = c.req.query("maxSendable") || 100000000000;
    try {
      const user = await getUser(
        username.replace("lightning:", "").replace(/\s/g, "").replace("=", "").toLowerCase(),
      );

      if (!user) fail(`User ${username} not found`);
      const { id: uid } = user;

      const metadata = JSON.stringify([
        ["text/plain", `Paying ${username}@${host}`],
        ["text/identifier", `${username}@${host}`],
      ]);

      const id = v4();
      await s(`lnurl:${id}`, uid);

      return c.json({
        allowsNostr: true,
        minSendable,
        maxSendable,
        metadata,
        nostrPubkey: serverPubkey2,
        commentAllowed: 512,
        callback: `${URL}/api/lnurl/${id}`,
        tag: "payRequest",
      });
    } catch (e) {
      if (!e.message.includes("found"))
        warn("problem generating lnurlp request", username, e.message);
      return bail(c, e.message);
    }
  },

  async lnurl(c) {
    const id = c.req.param("id");
    const amount = c.req.query("amount");
    const comment = c.req.query("comment");
    const nostr = c.req.query("nostr");
    try {
      const iid = await g(`lnurl:${id}:invoice`);
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
          await s(`zap:${id}`, event);
          metadata = nostr;
        } catch (e) {
          err("problem handling zap", e.message);
        }
      }

      const invoice = iid
        ? await gf(`invoice:${iid}`)
        : await generate({
            invoice: {
              amount: Math.round(amount / 1000),
              memo: metadata,
              type: PaymentType.lightning,
            },
            user,
          });

      return c.json({
        pr: invoice.text,
        routes: [],
        verify: `${URL}/api/lnurl/verify/${invoice.id}`,
      });
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async verify(c) {
    const id = c.req.param("id");
    const inv = await getInvoice(id);
    if (!inv) return c.json({ status: "ERROR", reason: "Not found" });

    const { hash, received, amount, preimage } = inv;
    const settled = received >= amount;

    return c.json({ pr: hash, status: "OK", settled, preimage: preimage || null });
  },

  async pay(c) {
    const amount = c.req.param("amount");
    const username = c.req.param("username");
    try {
      const user = await getUser(username);

      const invoices = await db.lRange(`${user.id}:invoices`, 0, 10);
      let invoice;

      for (const iid of invoices) {
        const i = await getInvoice(iid);
        const paid = i.amount > 0 && i.received >= i.amount;
        const old = Date.now() - i.created > fiveMinutes;
        if (paid) break;
        if (i.own && !old) {
          invoice = i;
          break;
        }
      }

      if (invoice) {
        if (amount?.startsWith("+")) {
          const tip = invoice.amount * amount.split("+")[1];
          invoice = await generate({
            invoice: {
              ...invoice,
              tip,
            },
            user,
          });
        }
      } else {
        invoice = await generate({
          invoice: {
            amount,
            prompt: user.prompt,
            type: PaymentType.lightning,
          },
          user,
        });
      }

      const { id: uid } = user;

      const metadata = JSON.stringify([
        ["text/plain", `Paying ${username}@${host}`],
        ["text/identifier", `${username}@${host}`],
      ]);

      const id = v4();

      const total = (parseInt(invoice.amount || 0) + parseInt(invoice.tip || 0)) * 1000;

      await s(`lnurl:${id}`, uid);
      if (total > 0) await s(`lnurl:${id}:invoice`, invoice.id);

      return c.json({
        allowsNostr: true,
        minSendable: invoice.amount ? total : 1000,
        maxSendable: invoice.amount ? total : 10 * 1000 * SATS,
        metadata,
        nostrPubkey: serverPubkey2,
        commentAllowed: 512,
        callback: `${URL}/api/lnurl/${id}`,
        tag: "payRequest",
      });
    } catch (e) {
      if (!e.message.includes("found"))
        warn("problem generating lnurlp request", username, e.message);
      return bail(c, e.message);
    }
  },
};
