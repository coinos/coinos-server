import { createHash } from "node:crypto";
import { db, g } from "$lib/db";
import { parseEntry } from "$lib/invoices";
import { bail, fail } from "$lib/utils";

// Merchants pre-load payment preimages here, then have buyers create invoices
// with usePreimage: true — each such invoice consumes the next queued preimage
// so its payment hash is sha256(preimage). Once paid, the preimage is exposed
// on the invoice record, letting a static storefront sell decryption secrets
// with no backend of its own. An optional per-batch price — sats, or a fiat
// amount converted at invoice-creation time — is enforced at invoice creation;
// creation is unauthenticated, so without it a buyer could name their own
// price for the secret.

const MAX_QUEUE = 1000;
const key = (uid) => `${uid}:preimages`;
const sha256 = (hex) =>
  createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");

export default {
  async add(req, res) {
    try {
      const { preimages, price = null, fiat = null } = req.body;
      let { currency = null } = req.body;
      if (!Array.isArray(preimages) || !preimages.length)
        fail("preimages array required");
      if (
        !preimages.every(
          (p) => typeof p === "string" && /^[0-9a-f]{64}$/i.test(p),
        )
      )
        fail("preimages must be 64-character hex strings");
      if (price !== null && fiat !== null)
        fail("specify price (sats) or fiat, not both");
      if (price !== null && (!Number.isInteger(price) || price <= 0))
        fail("price must be a positive integer amount of sats");
      if (fiat !== null) {
        if (typeof fiat !== "number" || !(fiat > 0))
          fail("fiat must be a positive number");
        currency ||= req.user.currency;
        const rates = await g("rates");
        if (!rates?.[currency]) fail(`unsupported currency ${currency}`);
      } else {
        currency = null;
      }

      const k = key(req.user.id);
      const existing = await db.lRange(k, 0, -1);
      const seen = new Set(existing.map((e) => parseEntry(e).preimage));
      const fresh = [];
      for (let p of preimages) {
        p = p.toLowerCase();
        if (seen.has(p)) continue;
        seen.add(p);
        fresh.push(p);
      }

      if (existing.length + fresh.length > MAX_QUEUE)
        fail(`queue limited to ${MAX_QUEUE} preimages`);
      if (fresh.length)
        await db.rPush(
          k,
          fresh.map((preimage) =>
            JSON.stringify({ preimage, price, fiat, currency }),
          ),
        );

      res.send({
        queued: existing.length + fresh.length,
        added: fresh.map((preimage) => ({
          preimage,
          hash: sha256(preimage),
          price,
          fiat,
          currency,
        })),
      });
    } catch (e) {
      bail(res, e.message);
    }
  },

  async list(req, res) {
    try {
      const entries = await db.lRange(key(req.user.id), 0, -1);
      res.send({
        queued: entries.length,
        preimages: entries.map((e) => {
          const { preimage, price, fiat, currency } = parseEntry(e);
          return { preimage, hash: sha256(preimage), price, fiat, currency };
        }),
      });
    } catch (e) {
      bail(res, e.message);
    }
  },

  async clear(req, res) {
    try {
      await db.del(key(req.user.id));
      res.send({ queued: 0 });
    } catch (e) {
      bail(res, e.message);
    }
  },
};
