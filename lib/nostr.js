import app from "$app";
import config from "$config";
import { Relay, RelayPool } from "nostr";
import { broadcast } from "$lib/sockets";
import store from "$lib/store";
import { g, s, db } from "$lib/db";
import { nada, wait } from "$lib/utils";

export let pool;

export let fillPool = () => {
  pool = RelayPool(config.relays);
  pool.on("open", relay => {
    if (relay.url.includes(config.relay)) coinos = relay;
    relay.subscribe("live", { limit: 1 });
  });

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

        await s(`user:${pubkey}`, JSON.stringify(user));
        coinos.send(ev);
      } else if (sub.includes("follows")) {
        let pubkey = sub.split(":")[0];
        await s(`${pubkey}:follows`, JSON.stringify(ev.tags));
        for (let f of ev.tags) {
          let [_, followPubkey] = f;
          await db.sAdd(`${followPubkey}:followers`, pubkey);
        }
        coinos.send(ev);
      } else if (sub.includes("followers")) {
        let followed = sub.split(":")[0];
        let { pubkey } = ev;
        await db.sAdd(`${followed}:followers`, pubkey);
        coinos.send(ev);
      } else if (sub.includes("notes")) {
        let pubkey = sub.split(":")[0];
        await db.sAdd(pubkey, ev.id);
        await s(`ev:${ev.id}`, JSON.stringify(ev));
      }
    } catch (e) {
      console.log(e);
    }
  });
};

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
    query.since = await g(`since:${sub}`);
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
        await s(`since:${sub}`, now());
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
  JSON.parse(await g(`user:${pubkey}`)) || {
    username: pubkey.substr(0, 6),
    pubkey,
    anon: true
  };
