import { g, s, db } from "$lib/db";
import { v4 } from "uuid";
import { bail, fail } from "$lib/utils";

export default {
  async list({ params: { id } }, res) {
    let items = await db.lRange(`${id}:items`, 0, -1);
    items = await Promise.all(items.map(async (id) => await g(`item:${id}`)));
    res.send(items);
  },

  async get({ params: { id } }, res) {
    try {
      let item = await g(`item:${id}`);
      console.log("ITEM", item);
      if (!item) fail("Item not found");
      res.send(item);
    } catch (e) {
      bail(res, e.message);
    }
  },

  async create({ body: item, user: { id } }, res) {
    if (!item.id) {
      item.id = v4();
      await db.lPush(`${id}:items`, item.id);
    }

      await s(`item:${item.id}`, item);

    res.send(item);
  },

  async del({ body: { item }, user: { id } }, res) {
    try {
      console.log(id);
      console.log(item.id);
      let n = await db.lRem(`${id}:items`, 0, item.id);
      if (n) db.del(`item:${item.id}`);
      else fail("item not found");

      res.send({});
    } catch (e) {
      bail(res, e.message);
    }
  },
};
