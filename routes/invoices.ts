import config from "$config";
import { db } from "$lib/db";
import { generate } from "$lib/invoices";
import { err } from "$lib/logging";
import { bail, fields, getInvoice, getUser } from "$lib/utils";
import rpc from "@coinos/rpc";

export default {
  async get(req, res) {
    const {
      params: { id },
    } = req;
    const invoice = await getInvoice(id);

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
    const { invoice } = body;

    if (body.user) user = body.user;
    if (req.user.username === user.username) invoice.own = true;

    try {
      const result = await generate({ invoice, user });
      res.send(result);
    } catch (e) {
      err(
        "problem generating invoice",
        req.user?.username,
        body.user?.username,
        e.message,
      );
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
