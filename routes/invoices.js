import { g, s } from "$lib/db";
import { generate } from "$lib/invoices";

export default {
  async get({ query: { hash } }, res) {
    let invoice = await g(`invoice:${hash}`);
    invoice.user = await g(`user:${invoice.uid}`);
    res.send(invoice);
  },

  async create({ body: { invoice, user }, user: sender }, res) {
    res.send(await generate({ invoice, user, sender }));
  }
};
