import app from "$app";
import db from "$db";
import redis from "$lib/redis";
import { coinos, pool, q } from "$lib/nostr";
import store from "$lib/store";
import { wait } from "$lib/utils";

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

    q(`${pubkey}:notes`, {
      kinds: [1],
      authors: [pubkey]
    }).catch(console.log);

    await redis.set(`user:${pubkey}`, JSON.stringify(user));

    let ids = await redis.sMembers(pubkey);
    console.log("IDS", ids);

    let events = ids.length
      ? (await redis.mGet(ids.map(k => "ev:" + k))).map(JSON.parse)
      : [];

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
