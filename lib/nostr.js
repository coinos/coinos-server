import { Relay, RelayPool } from "nostr";
import { got } from "got";
import { broadcast } from "$lib/sockets";
import store from "$lib/store";
import redis from "$lib/redis";

const { relays } = await got("https://nostr.watch/relays.json").json();

export const pool = RelayPool(relays);

pool.on("open", relay => {
  if (relay.url.includes("coinos")) coinos = relay;
  relay.subscribe("live", { limit: 1 });
});

export let coinos;
let seen = [];
let timeout;
pool.on("event", async (relay, sub, ev) => {
  try {
    let parsed;
    try {
      parsed = JSON.parse(ev.content);
    } catch (e) {
      parsed = ev.content;
    }

    if (sub === "live") {
      let { pubkey } = ev;

      if (Math.abs(Math.floor(Date.now() / 1000) - ev.created_at) > 7200)
        return;

      if (seen.includes(ev.id)) return;
      seen.push(ev.id);
      seen.length > 1000 && seen.shift();

      if (coinos && ev.kind < 5) {
        coinos.send(["EVENT", ev]);

        let newuser = {
          username: pubkey.substr(0, 6),
          pubkey,
          anon: true,
          follows: [],
          followers: []
        };

        ev.user = JSON.parse(await redis.get(`user:${pubkey}`)) || newuser;

        relay.subscribe("zero", {
          limit: 1,
          kinds: [0],
          authors: [pubkey]
        });

        broadcast("event", ev);
      }
    } else if (sub === "zero") {
      let { pubkey } = ev;
      let newuser = {
        username: pubkey.substr(0, 6),
        pubkey,
        anon: true,
        follows: [],
        followers: []
      };

      let user = JSON.parse(await redis.get(`user:${pubkey}`)) || newuser;

      if (user.profileUpdated > ev.created_at) return;

      if (parsed.name && user.username === pubkey.substr(0, 6))
        user.username = parsed.name;

      delete parsed.name;

      user = {
        ...user,
        ...parsed,
        initialized: true,
        profileUpdated: ev.created_at
      };

      await redis.set(`user:${pubkey}`, JSON.stringify(user));
      await redis.set(`user:${user.username}`, JSON.stringify(user));
    } else if (sub.includes("follows")) {
      let pubkey = sub.split(":")[0];
      await redis.set(`${pubkey}:follows`, JSON.stringify(ev.tags));
      for (let f of ev.tags) {
        let [_, followPubkey] = f;
        pool.subscribe("zero", {
          limit: 1,
          kinds: [0],
          authors: [followPubkey]
        });
        await redis.sAdd(`${followPubkey}:followers`, pubkey);
      }
      store.fetching[pubkey] = false;
    } else if (sub.includes("followers")) {
      let followed = sub.split(":")[0];
      let { pubkey } = ev;
      await redis.sAdd(`${followed}:followers`, pubkey);
      store.fetching[pubkey] = false;
    } else {
      if (!relay.url.includes("coinos")) return;

      let pubkey = sub;
      clearTimeout(store.timeouts[pubkey]);

      ev.user = JSON.parse(await redis.get(`user:${pubkey}`)) || {
        username: pubkey.substr(0, 6),
        pubkey,
        anon: true
      };

      await redis.sAdd(pubkey, ev.id);
      await redis.set(`ev:${ev.id}`, JSON.stringify(ev));

      store.fetching[pubkey] = true;
      store.timeouts[pubkey] = setTimeout(
        () => (store.fetching[pubkey] = false),
        100
      );
    }
  } catch (e) {
    console.log(e);
  }
});
