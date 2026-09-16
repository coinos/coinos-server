import { s } from "$lib/db";
import { check, get, redeem } from "$lib/ecash";
import { err } from "$lib/logging";
import { bail, fail, getInvoice, getUser } from "$lib/utils";
import { getEncodedToken } from "@cashu/cashu-ts";
import { v4 } from "uuid";

export default {
  async save(req, res) {
    const {
      body: { token },
    } = req;
    try {
      const id = v4();
      await s(`cash:${id}`, token);
      res.send({ id });
    } catch (e) {
      err(e.message);
      bail(res, e.message);
    }
  },

  async get(req, res) {
    const {
      params: { id },
    } = req;
    try {
      const token = await get(id);
      if (!token) fail("Ecash not found");
      const status = await check(token);
      res.send({ token, status });
    } catch (e) {
      err(e.message);
      bail(res, e.message);
    }
  },

  async claim(req, res) {
    const {
      body: { token },
      user,
    } = req;
    try {
      const amount = await redeem({ token, user });
      res.send({ ok: true, amount });
    } catch (e) {
      err(e.message);
      bail(res, e.message);
    }
  },

  // NUT-18 payment-request transport: a wallet POSTs proofs for one of our
  // ecash-type invoices, which are melted into a Lightning invoice for the
  // invoice's owner under the same id.
  async receive(req, res) {
    try {
      const { id, proofs, mint, memo } = req.body;
      const invoice = await getInvoice(id);
      if (!invoice) fail("Invoice not found");
      const user = await getUser(invoice.uid);
      if (!user) fail("User not found");

      await redeem({
        token: getEncodedToken({ mint, proofs }),
        user,
        invoice,
        memo,
      });

      res.send({ id });
    } catch (e) {
      err(e.message);
      bail(res, e.message);
    }
  },
};
