import { g, s } from "$lib/db";
import { generate } from "$lib/invoices";
import { fail } from "$lib/utils";
import got from "got";
import config from "$config";

export default {
  async get({ params: { hash } }, res) {
    let invoice = await g(`invoice:${hash}`);

    if (invoice) {
      invoice.user = await g(`user:${invoice.uid}`);
    } else {
      invoice = await got(`${config.classic}/invoice/${hash}`).json();
      fail("invoice not found");
      invoice.id = invoice.uuid;
      invoice.classic = true;
      invoice.user.id = invoice.user.uuid;
      invoice.user.username += "@classic";
    }

    res.send(invoice);
  },

  async create({ body: { invoice, user }, user: sender }, res) {
    res.send(await generate({ invoice, user, sender }));
  },

  async classic({ params: { username } }, res) {
    let invoice = await got
      .post(`${config.classic}/invoice`, {
        json: {
          invoice: { amount: 0, network: "lightning" },
          user: { username }
        }
      })
      .json();

    res.send(invoice);
  }
};
