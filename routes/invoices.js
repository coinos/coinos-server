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
        "pubkey"
      ]);
    } else if (config.classic) {
      invoice = await got(`${config.classic}/invoice/${id}`).json();
      if (invoice) {
        invoice.id = invoice.uuid;
        invoice.classic = true;
        invoice.user.id = invoice.user.uuid;
        invoice.user.username += "@classic";
      }
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
