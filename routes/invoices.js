import { g, s } from "$lib/db";
import { invoice } from "$lib/invoices";

export default {
  async get({ query: { hash } }, res) {
    let invoice = await g(`invoice:${hash}`);
    invoice.user = await g(`user:${invoice.uid}`);
    res.send(invoice);
  },

  async create({ body: { invoice, user }, user: sender }, res) {
    res.send(await invoice({ invoice, user, sender }));
  }
};
