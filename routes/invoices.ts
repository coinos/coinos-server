import config from "$config";
import { db, g } from "$lib/db";
import { generate } from "$lib/invoices";
import { err } from "$lib/logging";
import { bail, fields, getInvoice, getUser } from "$lib/utils";
import rpc from "@coinos/rpc";

export default {
  async get(req, res) {
    const {
      params: { id },
    } = req;
    let invoice = await g(`invoice:${id}`);
    if (typeof invoice === "string") invoice = await g(`invoice:${invoice}`);

    if (invoice) {
      invoice.secret = undefined;
      invoice.user = await getUser(invoice.uid, fields);

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

  async sign(req, res) {
    try {
      const { address, message, type = "bitcoin" } = req.body;
      const node = rpc(config[type]);

      if (config[type].walletpass)
        await node.walletPassphrase(config[type].walletpass, 300);

      const signature = await node.signMessage({ address, message });
      res.send({ signature });
    } catch (e) {
      bail(res, e.message);
    }
  },
};
