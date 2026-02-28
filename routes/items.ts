import { g, s, db } from "$lib/db";
import { v4 } from "uuid";
import { bail, fail } from "$lib/utils";

export default {
  async list(c) {
    const uid = c.req.param("id");
    const items = [];
    for (const id of await db.lRange(`${uid}:items`, 0, -1)) {
      const item = await g(`item:${id}`);
      if (item) items.push(item);
      else await db.lRem(`${uid}:items`, 0, id);
    }

    return c.json(items);
  },

  async get(c) {
    const id = c.req.param("id");
    try {
      const item = await g(`item:${id}`);
      if (!item) fail("Item not found");
      return c.json(item);
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async create(c) {
    const item = await c.req.json();
    const user = c.get("user");
    const { id } = user;
    try {
      if (!item.id) {
        item.id = v4();
        await db.lPush(`${id}:items`, item.id);
      }

      if (!parseFloat(item.price)) fail("Invalid price");
      item.name = item.name.replace(/[^a-zA-Z0-9 ]/g, "");

      await s(`item:${item.id}`, item);

      return c.json(item);
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async del(c) {
    const body = await c.req.json();
    const { item } = body;
    const user = c.get("user");
    const { id } = user;
    try {
      const n = await db.lRem(`${id}:items`, 0, item.id);
      if (n) db.del(`item:${item.id}`);
      else fail("item not found");

      return c.json({});
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async sort(c) {
    const body = await c.req.json();
    const { items } = body;
    const user = c.get("user");
    const { id } = user;
    try {
      await db.del(`${id}:items`);

      for (const item of items) {
        await db.rPush(`${id}:items`, item.id);
      }

      return c.json({});
    } catch (e) {
      return bail(c, e.message);
    }
  },
};
