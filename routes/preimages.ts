import { createHash } from "node:crypto";
import { db } from "$lib/db";
import { bail, fail } from "$lib/utils";

// Merchants pre-load payment preimages here, then have buyers create invoices
// with usePreimage: true — each such invoice consumes the next queued preimage
// so its payment hash is sha256(preimage). Once paid, the preimage is exposed
// on the invoice record, letting a static storefront sell decryption secrets
// with no backend of its own.

const MAX_QUEUE = 1000;
const key = (uid) => `${uid}:preimages`;
const sha256 = (hex) =>
  createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");

export default {
  async add(req, res) {
    try {
      const { preimages } = req.body;
      if (!Array.isArray(preimages) || !preimages.length)
        fail("preimages array required");
      if (
        !preimages.every(
          (p) => typeof p === "string" && /^[0-9a-f]{64}$/i.test(p),
        )
      )
        fail("preimages must be 64-character hex strings");

      const k = key(req.user.id);
      const existing = await db.lRange(k, 0, -1);
      const seen = new Set(existing);
      const fresh = [];
      for (let p of preimages) {
        p = p.toLowerCase();
        if (seen.has(p)) continue;
        seen.add(p);
        fresh.push(p);
      }

      if (existing.length + fresh.length > MAX_QUEUE)
        fail(`queue limited to ${MAX_QUEUE} preimages`);
      if (fresh.length) await db.rPush(k, fresh);

      res.send({
        queued: existing.length + fresh.length,
        added: fresh.map((preimage) => ({ preimage, hash: sha256(preimage) })),
      });
    } catch (e) {
      bail(res, e.message);
    }
  },

  async list(req, res) {
    try {
      const preimages = await db.lRange(key(req.user.id), 0, -1);
      res.send({
        queued: preimages.length,
        preimages: preimages.map((preimage) => ({
          preimage,
          hash: sha256(preimage),
        })),
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
