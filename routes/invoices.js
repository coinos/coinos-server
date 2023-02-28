import { g, s } from "$lib/db";
import { generate } from "$lib/invoices";
import { fail, pick } from "$lib/utils";
import whitelist from "$lib/whitelist";
import got from "got";
import config from "$config";
import ln from "$lib/ln";

export default {
  async get({ params: { hash } }, res) {
    let pr;
    if (hash.startsWith("ln")) {
      ({ payment_hash: hash } = await ln.decode(hash));
    }

    let invoice = await g(`invoice:${hash}`);

    if (invoice) {
      invoice.user = pick(await g(`user:${invoice.uid}`), whitelist);
      invoice.id = hash;
    } else if (config.classic) {
      invoice = await got(`${config.classic}/invoice/${pr}`).json();
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
