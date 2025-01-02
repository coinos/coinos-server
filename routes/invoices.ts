import { db, g } from "$lib/db";
import { generate } from "$lib/invoices";
import { err } from "$lib/logging";
import { bail, getInvoice, pick } from "$lib/utils";

export default {
  async get(req, res) {
    const {
      params: { id },
    } = req;
    let invoice = await g(`invoice:${id}`);
    if (typeof invoice === "string") invoice = await g(`invoice:${invoice}`);

    if (invoice) {
      invoice.secret = undefined;
      invoice.user = pick(await g(`user:${invoice.uid}`), [
        "id",
        "picture",
        "banner",
        "currency",
        "username",
        "pubkey",
      ]);

      invoice.items ||= [];
    }
    if (invoice) res.send(invoice);
    else res.code(500).send("invoice not found");
  },

  async create(req, res) {
    let { body, user } = req;
    if (body.user) user = body.user;
    const { invoice } = body;

    try {
      res.send(await generate({ invoice, user }));
    } catch (e) {
      console.log(e);
      err("problem generating invoice", e.message);
      bail(res, e.message);
    }
  },

  async list(req, res) {
    const { id } = req.user;
    let invoices = await db.lRange(`${id}:invoices`, 0, -1);
    invoices = await Promise.all(invoices.map((i) => getInvoice(i)));
    res.send(invoices);
  },
};
