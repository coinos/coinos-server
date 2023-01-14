import app from "$app";
import store from "$lib/store";
import { optionalAuth } from "$lib/passport";
import { l } from "$lib/logging";
import { emit } from "$lib/sockets";
import { rd, g, s } from "$lib/redis";
import ln from "$lib/ln";

app.get("/invoice", async ({ query: { id } }, res) => {
  let invoice = await g(`invoice:${id}`);
  invoice.user = await g(`user:${invoice.user_id}`);
  console.log("INV", invoice)
  res.send(invoice);
});

app.post(
  "/invoice",
  optionalAuth,
  async ({ body: { invoice, user }, user: me }, res) => {
    let { currency, tip, amount, rate, request_id } = invoice;

    if (amount < 0) throw new Error("amount out of range");
    if (tip > 5 * amount || tip < 0) throw new Error("tip amount out of range");
    tip = tip || 0;

    if (!user) user = me;
    let user_id = await g(`user:${user.username}`);
    user = await g(`user:${user_id}`);

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
      user_id,
      text
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
    await rd.lPush(`${user.id}:invoices`, id);

    if (request_id) {
      let request = await g(`request:${request_id}`);
      let { invoice_id: prev } = request;
      request.invoice_id = invoice.id;
      await s(`request:${request_id}`, request);

      if (!prev) emit(request.requester.username, "invoice", invoice);
    }

    res.send(invoice);
  }
);
