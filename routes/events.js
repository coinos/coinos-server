import app from "$app";
import db from "$db";
import redis from "$lib/redis";
import { pool } from "$lib/nostr";
import store from "$lib/store";
import { wait } from "$lib/utils";

app.get("/:pubkey/events", async (req, res) => {
  try {
    let { pubkey } = req.params;
    store.fetching[pubkey] = true;
    store.timeouts[pubkey] = setTimeout(
      () => (store.fetching[pubkey] = false),
      500
    );

    let user = await db.User.findOne({
      where: { pubkey }
    }); 

    if (!user) user = { username: pubkey.substr(0,6), pubkey, anon: true }
    await redis.set(`user:${pubkey}`, JSON.stringify(user));

    pool.subscribe(pubkey, {
      limit: 500,
      kinds: [1],
      authors: [pubkey]
    });

    let events = [];
    await wait(() => !store.fetching[pubkey], 10, 10);
    for (let id of await redis.sMembers(pubkey)) {
      events.push(JSON.parse(await redis.get(`ev:${id}`)));
    }

    res.send(events);
  } catch (e) {
    console.log(e);
    res.code(500).send("problem fetching user events");
  }
});

app.post("/nostr/send", async (req, res) => {
  let { event } = req.body;
  pool.send(["EVENT", event]);
  res.send(event);
});
