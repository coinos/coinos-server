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
let now = () => Math.round(Date.now() / 1000);

let timeouts = {};
export let q = async (sub, query, timeout = 8000) =>
  new Promise(async (r, j) => {
    let rejected;
    if (!coinos) return j(new Error("relay not initialized"));
    query.since = await redis.get(`since:${sub}`);
    if (now() - query.since < 3600) return r();

    coinos.on("eose", s => !rejected && s === sub && r(timeouts[sub].clear()));

    coinos.subscribe(sub, query);

    timeouts[sub] = {
      async clear() {
        clearTimeout(this.timer);
        delete timeouts[sub];
        coinos.unsubscribe(sub);
        await redis.set(`since:${sub}`, now());
      },
      extend(t = timeout) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          j(new Error(`query timed out: ${sub} ${Date.now()}`));
          coinos.unsubscribe(sub);
          rejected = true;
        }, t);
      },
      timer: undefined
    };

    timeouts[sub].extend(timeout);
  });

let seen = [];

let getUser = async pubkey =>
  JSON.parse(await redis.get(`user:${pubkey}`)) || {
    username: pubkey.substr(0, 6),
    pubkey,
    anon: true
  };

pool.on("event", async (relay, sub, ev) => {
  if (timeouts[sub]) timeouts[sub].extend();
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
        coinos.send(["EVENT", ev]);

        ev.user = await getUser(pubkey);

        broadcast("event", ev);
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
    } else if (sub.includes("follows")) {
      let pubkey = sub.split(":")[0];
      await redis.set(`${pubkey}:follows`, JSON.stringify(ev.tags));
      for (let f of ev.tags) {
        let [_, followPubkey] = f;
        await redis.sAdd(`${followPubkey}:followers`, pubkey);
      }
    } else if (sub.includes("followers")) {
      let followed = sub.split(":")[0];
      let { pubkey } = ev;
      await redis.sAdd(`${followed}:followers`, pubkey);
    } else {
      if (!relay.url.includes("coinos")) return;

      let pubkey = sub;
      ev.user = await getUser(pubkey);

      //     console.log(ev.user.username, "UPDATED AT", ev.user.updated)
      if (!ev.user.updated) {
        relay.subscribe(`${pubkey}:${ev.id}:profile`, {
          limit: 1,
          kinds: [0],
          authors: [pubkey]
        });
      }

      await redis.sAdd(pubkey, ev.id);
      await redis.set(`ev:${ev.id}`, JSON.stringify(ev));
    }
  } catch (e) {
    console.log(e);
  }
});
