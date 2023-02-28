import { fail } from "$lib/utils";
import { emit } from "$lib/sockets";
import { g, s, db } from "$lib/db";
import { v4 } from "uuid";

export default {
  async get({ params: { id } }, res) {
    let request = await g(`request:${id}`);
    if (!request) fail("request not found");
    request.recipient = await g(`user:${request.recipient_id}`);
    request.requester = await g(`user:${request.requester_id}`);
    request.invoice = await g(`invoice:${request.invoice_id}`);
    res.send({ request });
  },

  async list({ user: { id } }, res) {
    try {
      const day = new Date(new Date().setDate(new Date().getDate() - 1));
      let requests = await db.lRange(`${id}:requests`, 0, -1);
      requests = await Promise.all(requests.map(id => g(`request:${id}`)));
      
      requests = await Promise.all(
        requests.map(async r => {
          r.requester = await g(`user:${r.requester_id}`);
          r.recipient = await g(`user:${r.recipient_id}`);
          return r;
        })
      );

      let sent = requests.filter(r => r.requester_id === id);

      let received = requests
        .filter(r => r.recipient_id === id)
        .filter(r => !r.invoice_id);

      let invoices = [];
      for (let r of sent) {
        if (!r.invoice_id) continue;

        let invoice = await g(`invoice:${r.invoice_id}`);
        if (!invoice) continue;

        invoice.request = r;
        if (invoice.amount < invoice.received) invoices.push(invoice);
      }

      res.send({ invoices, sent, received });
    } catch (e) {
      console.log(e);
      res.code(500).send(e.message);
    }
  },

  async create(
    {
      body: { recipient, ...params },
      user: { id: requester_id, username, profile }
    },
    res
  ) {
    let recipient_id = await g(`user:${recipient}`);

    let id = v4();
    let request = {
      id,
      recipient_id,
      requester_id,
      ...params
    };

    await s(`request:${id}`, request);
    await db.lPush(`${requester_id}:requests`, id);
    await db.lPush(`${recipient_id}:requests`, id);

    emit(recipient, "request", request);
    res.send(request);
  },

  async destroy({ body: { request_id }, user: { id } }, res) {
    await db.lrem(`user:${id}:requests`, request_id);
    res.send();
  }
};
