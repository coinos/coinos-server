import config from "$config";
import { db, g, gf, s } from "$lib/db";
import { generate } from "$lib/invoices";
import { err } from "$lib/logging";
import { bail, fail, fields, getAccount, getInvoice, getUser } from "$lib/utils";
import rpc from "@coinos/rpc";

export default {
  async get(c) {
    try {
      const id = c.req.param("id");
      if (id === "undefined") fail("invalid id");
      const invoice = await getInvoice(id);

      if (invoice) {
        invoice.secret = undefined;
        invoice.user = await getUser(invoice.uid, fields);
        invoice.account = await getAccount(invoice.aid);

        invoice.items ||= [];
      }
      if (invoice) return c.json(invoice);
      else fail("invoice not found");
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async create(c) {
    const body = await c.req.json();
    let user = c.get("user");
    const { invoice } = body;

    if (body.user) user = body.user;
    if (c.get("user")?.username === user.username) invoice.own = true;
    else invoice.own = false;

    try {
      const result = await generate({ invoice, user });
      return c.json(result);
    } catch (e) {
      console.trace();
      console.log(e);
      err("problem generating invoice", c.get("user")?.username, body.user?.username, e.message);
      return bail(c, e.message);
    }
  },

  async update(c) {
    try {
      const id = c.req.param("id");
      const body = await c.req.json();
      const { tip, webhook, secret, received: _received } = body.invoice;

      if (tip < 0) fail("Invalid tip");

      let invoice = await gf(`invoice:${id}`);
      const user = await g(`user:${invoice.uid}`);

      if (typeof tip !== "undefined") invoice.tip = tip;

      if (webhook && secret) {
        if (invoice.uid !== c.get("user")?.id) fail("Unauthorized");
        invoice.webhook = webhook;
        invoice.secret = secret;
      }

      invoice = await generate({ invoice, user });

      await s(`invoice:${id}`, invoice);

      return c.json(invoice);
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async list(c) {
    const user = c.get("user");
    const { id } = user;
    let invoices = await db.lRange(`${id}:invoices`, 0, -1);
    invoices = (await Promise.all(invoices.map((i) => getInvoice(i)))).filter(Boolean);
    return c.json(invoices);
  },

  async sign(c) {
    try {
      const body = await c.req.json();
      const { address, message, type = "bitcoin" } = body;
      const node = rpc(config[type]);

      if (config[type].walletpass) await node.walletPassphrase(config[type].walletpass, 300);

      const signature = await node.signMessage({ address, message });
      return c.json({ signature });
    } catch (e) {
      return bail(c, e.message);
    }
  },
};
