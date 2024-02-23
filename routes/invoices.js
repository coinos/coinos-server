import { g, s } from "$lib/db";
import { generate } from "$lib/invoices";
import { bail, fail, pick } from "$lib/utils";
import whitelist from "$lib/whitelist";
import got from "got";
import config from "$config";
import ln from "$lib/ln";

export default {
  async get({ params: { id } }, res) {
    let invoice = await g(`invoice:${id}`);
    if (typeof invoice === "string") invoice = await g(`invoice:${invoice}`);

    if (invoice) {
      delete invoice.secret;
      invoice.user = pick(await g(`user:${invoice.uid}`), [
        "id",
        "profile",
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

  async create({ body: { invoice, user }, user: sender }, res) {
    try {
      res.send(await generate({ invoice, user, sender }));
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },
};
