import store from "$lib/store";
import { l } from "$lib/logging";
import { emit } from "$lib/sockets";
import { db, g, s } from "$lib/db";
import ln from "$lib/ln";

export default {
  async get({ query: { id } }, res) {
    let invoice = await g(`invoice:${id}`);
    invoice.user = await g(`user:${invoice.uid}`);
    res.send(invoice);
  },

  async create({ body: { invoice, user }, user: me }, res) {
    let { currency, tip, amount, rate, request_id } = invoice;

    if (amount < 0) throw new Error("amount out of range");
    if (tip > 5 * amount || tip < 0) throw new Error("tip amount out of range");
    tip = tip || 0;

    if (!user) user = me;
    let uid = await g(`user:${user.username}`);
    user = await g(`user:${uid}`);

    if (!user) throw new Error("user not provided");

    if (!currency) currency = user.currency;
    if (!rate) rate = store.rates[currency];
    if (amount < 0) throw new Error("invalid amount");

    let { payment_hash: id, bolt11: text } = await ln.invoice(
      amount ? `${amount + tip}sat` : "any",
      new Date(),
      "",
      3600
    );

    invoice = {
      ...invoice,
      id,
      amount,
      currency,
      rate,
      tip,
      uid,
      text,
      received: 0,
      created: Date.now()
    };

    l(
      "creating invoice",
      user.username,
      amount,
      tip,
      currency,
      `${text.substr(0, 8)}..${text.substr(-6)}`
    );

    await s(`invoice:${id}`, invoice);
    await db.lPush(`${uid}:invoices`, id);

    if (request_id) {
      let request = await g(`request:${request_id}`);
      let { invoice_id: prev } = request;
      request.invoice_id = invoice.id;
      await s(`request:${request_id}`, request);

      if (!prev) emit(request.requester.username, "invoice", invoice);
    }

    res.send(invoice);
  }
};
