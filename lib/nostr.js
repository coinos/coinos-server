import app from "$app";
import config from "$config";
import { Relay, RelayPool } from "nostr";
import { broadcast } from "$lib/sockets";
import store from "$lib/store";
import redis from "$lib/redis";
import proxy from "@fastify/http-proxy";
import { nada, wait } from "$lib/utils";

export let pool;
try {
  pool = RelayPool(config.relays);
} catch(e) {
  console.log(e)
} 


pool.on("open", relay => {
  if (relay.url.includes(config.relay)) coinos = relay;
  relay.subscribe("live", { limit: 1 });
});

export let coinos;
let now = () => Math.round(Date.now() / 1000);

let timeouts = {};
export let q = async (
  sub,
  query,
  { timeout = 20000, since = 3600, eager = 200 }
) =>
  new Promise(async (r, j) => {
    let start = Date.now();
    let seen = [];
    let rejected;
    query.since = await redis.get(`since:${sub}`);
    if (now() - query.since < since) return r();

    let done = { [sub]: [] };

    let check = s => {
      let elapsed = Date.now() - start;
      if (rejected) return true;
      if (
        done[s] &&
        (done[s].length === pool.relays.length ||
          (done[s].length && elapsed > eager))
      ) {
        r();
        if (timeouts[s]) timeouts[s].clear();
        return true;
      }
    };

    timeouts[sub] = {
      async clear() {
        clearTimeout(this.timer);
        delete timeouts[sub];
        pool.unsubscribe(sub);
        await redis.set(`since:${sub}`, now());
      },
      extend(ev) {
        if (ev) {
          if (seen.includes(ev.id)) return;
          seen.push(ev.id);
          seen.length > 1000 && seen.shift();
        }

        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          j(new Error(`query timed out: ${sub} ${Date.now()}`));
          pool.unsubscribe(sub);
          rejected = true;
        }, timeout);
      },
      timer: undefined
    };

    timeouts[sub].extend();
    pool.subscribe(sub, query);

    pool.on("eose", (relay, s) => {
      if (done[s]) done[s].push(relay.url);
      check(s);
    });

    try {
      await wait(() => check(sub), 100, 200);
    } catch (e) {
      console.log(e);
    }
  });

let seen = [];

let getUser = async pubkey =>
  JSON.parse(await redis.get(`user:${pubkey}`)) || {
    username: pubkey.substr(0, 6),
    pubkey,
    anon: true
  };

pool.on("event", async (relay, sub, ev) => {
  if (timeouts[sub]) timeouts[sub].extend(ev);
  try {
    let content;
    try {
      content = JSON.parse(ev.content);
    } catch (e) {
      content = ev.content;
    }

    if (sub === "live") {
      let { pubkey } = ev;

      if (Math.abs(Math.floor(Date.now() / 1000) - ev.created_at) > 7200)
        return;

      if (seen.includes(ev.id)) return;
      seen.push(ev.id);
      seen.length > 1000 && seen.shift();

      if (coinos && ev.kind < 5) {
        // coinos.send(["EVENT", ev]);
        ev.user = await getUser(pubkey);
        // broadcast("event", ev);
      }
    } else if (sub.includes("profile")) {
      let { pubkey } = ev;
      let user = await getUser(pubkey);

      if (user.updated > ev.created_at) return;

      if (content.name && user.username === pubkey.substr(0, 6))
        user.username = content.name;

      delete content.name;

      user = {
        ...user,
        ...content,
        updated: ev.created_at
      };

      await redis.set(`user:${pubkey}`, JSON.stringify(user));
      await redis.set(`user:${user.username}`, JSON.stringify(user));
      coinos.send(ev);
    } else if (sub.includes("follows")) {
      let pubkey = sub.split(":")[0];
      await redis.set(`${pubkey}:follows`, JSON.stringify(ev.tags));
      for (let f of ev.tags) {
        let [_, followPubkey] = f;
        await redis.sAdd(`${followPubkey}:followers`, pubkey);
      }
      coinos.send(ev);
    } else if (sub.includes("followers")) {
      let followed = sub.split(":")[0];
      let { pubkey } = ev;
      await redis.sAdd(`${followed}:followers`, pubkey);
      coinos.send(ev);
    } else if (sub.includes("notes")) {
      let pubkey = sub.split(":")[0];
      await redis.sAdd(pubkey, ev.id);
      await redis.set(`ev:${ev.id}`, JSON.stringify(ev));
    }
  } catch (e) {
    console.log(e);
  }
});

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

app.get("/:pubkey/notes", async (req, res) => {
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

app.post("/event", async (req, res) => {
  let { event } = req.body;
  pool.send(["EVENT", event]);
  res.send(event);
});

app.get("/:pubkey/follows", async (req, res) => {
  try {
    let { pubkey } = req.params;
    let { tagsonly } = req.query;

    let sub = `${pubkey}:follows`;
    q(
      sub,
      {
        limit: 1,
        kinds: [3],
        authors: [pubkey]
      },
      { timeout: 60000, eager: 60000 }
    ).catch(nada);

    let tags = JSON.parse(await redis.get(`${pubkey}:follows`)) || [];
    if (tagsonly) return res.send(tags);

    let follows = [];
    for (let f of tags) {
      let [_, pubkey] = f;

      q(`${pubkey}:profile:f1`, {
        limit: 1,
        kinds: [0],
        authors: [pubkey]
      }).catch(nada);

      let user = JSON.parse(await redis.get(`user:${pubkey}`));

      if (!user)
        user = {
          username: pubkey.substr(0, 6),
          pubkey,
          anon: true
        };

      follows.push(user);
    }

    follows = uniq(follows, e => e.pubkey);
    follows.sort((a, b) => a.username.localeCompare(b.username));

    res.send(follows);
  } catch (e) {
    console.log(e);
    res.code(500).send(e && e.message);
  }
});

app.get("/:pubkey/followers", async (req, res) => {
  try {
    let { pubkey } = req.params;

    let pubkeys = [
      ...new Set([
        ...(await got(`${config.nostr}/followers?pubkey=${pubkey}`).json()),
        ...(await redis.sMembers(`${pubkey}:followers`))
      ])
    ];

    let followers = [];

    q(
      `${pubkey}:followers`,
      { kinds: [3], "#p": [pubkey] },
      { timeout: 60000, eager: 60000 }
    ).catch(nada);

    for (let pubkey of pubkeys) {
      let user = JSON.parse(await redis.get(`user:${pubkey}`));
      if (!user || !user.updated) {
        q(`${pubkey}:profile:f2`, {
          limit: 1,
          kinds: [0],
          authors: [pubkey]
        }).catch(nada);

        user = JSON.parse(await redis.get(`user:${pubkey}`));
      }

      if (!user)
        user = {
          username: pubkey.substr(0, 6),
          pubkey,
          anon: true
        };

      followers.push(user);
    }

    followers = uniq(followers, e => e.pubkey);
    followers.sort((a, b) => a.username.localeCompare(b.username));

    res.send(followers);
  } catch (e) {
    console.log(e);
    res.code(500).send(e && e.message);
  }
});

app.get('/nostr.json', async (req, res) => {
  res.send({
    names: {  adam: "566c166f3adab0c8fba5da015b0b3bcc8eb3696b455f2a1d43bfbd97059646a8", asoltys: "566c166f3adab0c8fba5da015b0b3bcc8eb3696b455f2a1d43bfbd97059646a8" }
  });
}); 

