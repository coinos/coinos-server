import app from "$app";
import store from "$lib/store";
import { optionalAuth } from "$lib/passport";
import { err, l } from "$lib/logging";
import { SATS, derivePayRequest } from "$lib/utils";
import { emit } from "$lib/sockets";
import { v4 } from "uuid";
import { rd, g, s } from "$lib/redis";

app.get("/invoice", async ({ query: { id } }, res) => {
  let invoice = await g(`invoice:${id}`);
  invoice.user = await g(`user:${invoice.user_id}`);
  res.send(invoice);
});

app.post(
  "/invoice",
  optionalAuth,
  async (
    {
      body: { type = "bech32", liquidAddress, id, invoice, user, tx },
      user: me
    },
    res
  ) => {
    let {
      blindkey,
      currency,
      tip,
      amount,
      rate,
      network,
      request_id
    } = invoice;
    let text;

    if (amount < 0) throw new Error("amount out of range");
    if (tip > 5 * amount || tip < 0) throw new Error("tip amount out of range");
    tip = tip || 0;

    if (!user) user = me;
    if (!user) throw new Error("user not provided");

    user = await g(`user:${user.id}`);

    if (!currency) currency = user.currency;
    if (!rate) rate = store.rates[currency];
    if (amount < 0) throw new Error("invalid amount");

    invoice = {
      ...invoice,
      id: v4(),
      amount,
      currency,
      rate,
      tip,
      unconfidential,
      user_id: user.id
    };

    invoice.text = await derivePayRequest(invoice);

    l(
      "creating invoice",
      user.username,
      network,
      amount,
      tip,
      currency,
      `${text.substr(0, 8)}..${text.substr(-6)}`
    );

    await rd.lPush(`${id}:invoices`, invoice.id);

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
