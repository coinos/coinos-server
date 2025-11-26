import config from "$config";
import { db, g, gf, s } from "$lib/db";
import { generate } from "$lib/invoices";
import { err } from "$lib/logging";
import { bail, fail, fields, getInvoice, getUser } from "$lib/utils";
import rpc from "@coinos/rpc";
import { v4 } from "uuid";

export default {
  async get(req, res) {
    try {
      const {
        params: { id },
      } = req;
      if (id === "undefined") fail("invalid id");
      const invoice = await getInvoice(id);

      if (invoice) {
        invoice.secret = undefined;
        invoice.user = await getUser(invoice.uid, fields);

        invoice.items ||= [];
      }
      if (invoice) res.send(invoice);
      else fail("invoice not found");
    } catch (e) {
      bail(res, e.message);
    }
  },

  async create(req, res) {
    let { body, user } = req;
    const { invoice } = body;

    if (body.user) user = body.user;
    if (req.user.username === user.username) invoice.own = true;
    else invoice.own = false;

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

  async update(req, res) {
    try {
      const { id } = req.params;
      const { body } = req;
      const { tip, webhook, secret, received } = body.invoice;

      if (tip < 0) fail("Invalid tip");

      let invoice = await gf(`invoice:${id}`);
      const user = await g(`user:${invoice.uid}`);

      if (typeof tip !== "undefined") invoice.tip = tip;

      if (webhook && secret) {
        if (invoice.uid !== req.user?.id) fail("Unauthorized");
        invoice.webhook = webhook;
        invoice.secret = secret;
      }

      invoice = await generate({ invoice, user });

      await s(`invoice:${id}`, invoice);

      res.send(invoice);
    } catch (e) {
      bail(res, e.message);
    }
  },

  async list(req, res) {
    const { id } = req.user;
    let invoices = await db.lRange(`${id}:invoices`, 0, -1);
    invoices = (await Promise.all(invoices.map((i) => getInvoice(i)))).filter(
      Boolean,
    );
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
