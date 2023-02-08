import { emit } from "$lib/sockets";
import { g, s, db } from "$lib/db";
import { v4 } from "uuid";

export default {
  async get({ params: { id } }, res) {
    try {
      let request = await g(`request:${id}`);
      request.recipient = await g(`user:${request.recipient_id}`);
      res.send({ request });
    } catch (e) {
      console.log(e);
      res.code(500).send(e.message);
    }
  },

  async list({ user: { id } }, res) {
    try {
      const day = new Date(new Date().setDate(new Date().getDate() - 1));

      let invoices = await db.lRange(`${id}:invoices`, 0, -1);
      let requests = await db.lRange(`${id}:requests`, 0, -1);

      res.send({ invoices, requests });
    } catch (e) {
      console.log(e);
      res.code(500).send(e.message);
    }
  },

  async create(
    { body: { recipient, ...params }, user: { username, profile } },
    res
  ) {
    let recipient_id = await g(`user:${recipient}`);

    let id = v4();
    let request = {
      id,
      recipient_id,
      requester: { username, profile },
      ...params
    };

    await s(`request:${id}`, request);
    emit(recipient, "request", request);
    res.send(request);
  },

  async destroy({ body: { request_id }, user: { id } }, res) {
    await db.lrem(`user:${id}:requests`, request_id);
    res.send();
  }
};
