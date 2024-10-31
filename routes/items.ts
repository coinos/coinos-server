import { g, s, db } from "$lib/db";
import { v4 } from "uuid";
import { bail, fail } from "$lib/utils";

export default {
  async list(req, res) {
    const {
      params: { id: uid },
    } = req;
    const items = [];
    for (const id of await db.lRange(`${uid}:items`, 0, -1)) {
      const item = await g(`item:${id}`);
      if (item) items.push(item);
      else await db.lRem(`${uid}:items`, 0, id);
    }

    res.send(items);
  },

  async get(req, res) {
    const {
      params: { id },
    } = req;
    try {
      const item = await g(`item:${id}`);
      if (!item) fail("Item not found");
      res.send(item);
    } catch (e) {
      bail(res, e.message);
    }
  },

  async create(req, res) {
    const {
      body: item,
      user: { id },
    } = req;
    try {
      if (!item.id) {
        item.id = v4();
        await db.lPush(`${id}:items`, item.id);
      }

      if (!parseFloat(item.price)) fail("Invalid price");
      item.name = item.name.replace(/[^a-zA-Z0-9 ]/g, "");

      await s(`item:${item.id}`, item);

      res.send(item);
    } catch (e) {
      bail(res, e.message);
    }
  },

  async del(req, res) {
    const {
      body: { item },
      user: { id },
    } = req;
    try {
      const n = await db.lRem(`${id}:items`, 0, item.id);
      if (n) db.del(`item:${item.id}`);
      else fail("item not found");

      res.send({});
    } catch (e) {
      bail(res, e.message);
    }
  },

  async sort(req, res) {
    const {
      body: { items },
      user: { id },
    } = req;
    try {
      await db.del(`${id}:items`);

      for (const item of items) {
        await db.rPush(`${id}:items`, item.id);
      }

      res.send({});
    } catch (e) {
      bail(res, e.message);
    }
  },
};
