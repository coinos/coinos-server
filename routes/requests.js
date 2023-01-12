import app from "$app";
import { auth } from "$lib/passport";
import { emit } from "$lib/sockets";
import { g, rd } from "$lib/redis";

app.get("/request/:id", auth, async ({ params: { id } }, res) => {
  try {
    res.send({ request: await g(id) });
  } catch (e) {
    console.log(e);
    res.code(500).send(e.message);
  }
});

app.get("/requests", auth, async ({ user: { uuid } }, res) => {
  try {
    const day = new Date(new Date().setDate(new Date().getDate() - 1));

    let invoices = await rd.lRange(`${uuid}:invoices`, 0, -1);
    let requests = await rd.lRange(`${uuid}:requests`, 0, -1);

    res.send({ invoices, requests });
  } catch (e) {
    console.log(e);
    res.code(500).send(e.message);
  }
});

app.post(
  "/requests",
  auth,
  async (
    { body: { recipient, ...params }, user: { username, profile } },
    res
  ) => {
    let { id: recipient_id } = await g(`user:${recipient}`);

    let request = { recipient_id, ...params };
    request.requester = {
      username,
      profile
    };

    emit(recipient, "request", request);

    res.send(request);
  }
);

app.post(
  "/requests/delete",
  auth,
  async ({ body: { request_id }, user: { id } }, res) => {
    await rd.lrem(`user:${id}:requests`, request_id);
    res.send();
  }
);
