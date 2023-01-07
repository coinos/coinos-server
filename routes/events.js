import app from "$app";
import db from "$db";
import redis from "$lib/redis";
import { coinos, pool, q } from "$lib/nostr";
import store from "$lib/store";
import { nada, wait } from "$lib/utils";

app.get("/event/:id", async (req, res) => {
  try {
    let event = JSON.parse(await redis.get(`ev:${req.params.id}`));
    let { pubkey } = event;

    event.user = JSON.parse(await redis.get(`user:${pubkey}`)) || {
      username: pubkey.substr(0, 6),
      pubkey,
      anon: true,
      follows: [],
      followers: []
    };

    res.send(event);
  } catch (e) {
    res.code(500).send("Problem fetching event");
  }
});

app.get("/nostr/:pubkey", async (req, res) => {
  try {
    let { pubkey } = req.params;

    let user = JSON.parse(await redis.get(`user:${pubkey}`));

    if (!user) {
      user = await db.User.findOne({
        where: { pubkey }
      });
    }

    if (!user)
      user = {
        username: pubkey.substr(0, 6),
        pubkey,
        anon: true,
        follows: [],
        followers: []
      };

    q(
      `${pubkey}:notes`,
      {
        kinds: [1],
        authors: [pubkey]
      },
      { since: 0 }
    ).catch(nada);

    await redis.set(`user:${pubkey}`, JSON.stringify(user));

    let ids = await redis.sMembers(pubkey);

    let events = ids.length
      ? (await redis.mGet(ids.map(k => "ev:" + k))).map(JSON.parse)
      : [];

    res.send(events.map(e => ({ ...e, user })));
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
