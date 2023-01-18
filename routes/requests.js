import { emit } from "$lib/sockets";
import { g, db } from "$lib/db";

export default {
  async get({ params: { id } }, res) {
    try {
      res.send({ request: await g(id) });
    } catch (e) {
      console.log(e);
      res.code(500).send(e.message);
    }
  },

  async list({ user: { id } }, res) {
    try {
      const day = new Date(new Date().setDate(new Date().getDate() - 1));

      let invoices = await db.lrange(`${id}:invoices`, 0, -1);
      let requests = await db.lrange(`${id}:requests`, 0, -1);

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
    let { id: recipient_id } = await g(`user:${recipient}`);

    let request = { recipient_id, ...params };
    request.requester = {
      username,
      profile
    };

    emit(recipient, "request", request);

    res.send(request);
  },

  async destroy({ body: { request_id }, user: { id } }, res) {
    await db.lrem(`user:${id}:requests`, request_id);
    res.send();
  }
};
