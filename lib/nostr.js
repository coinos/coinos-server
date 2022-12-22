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

let coinos;
let seen = [];
let timeout;
pool.on("event", async (relay, sub, ev) => {
  try {
    if (sub === "live") {
      if (Math.abs(Math.floor(Date.now() / 1000) - ev.created_at) > 7200)
        return;

      if (seen.includes(ev.id)) return;
      seen.push(ev.id);
      seen.length > 1000 && seen.shift();

      if (coinos && ev.kind < 5) {
        let parsed;
        try {
          parsed = JSON.parse(ev.content);
        } catch (e) {
          parsed = ev.content;
        }

        coinos.send(["EVENT", ev]);
        if (ev.kind === 1) broadcast("event", ev);
      }
    } else {
      let pubkey = sub;
      clearTimeout(store.timeouts[pubkey]);

      store.fetching[pubkey] = true;
      await redis.sAdd(pubkey, ev.id);
      await redis.set(`ev:${ev.id}`, JSON.stringify(ev));

      store.timeouts[pubkey] = setTimeout(() => (store.fetching[pubkey] = false), 100);
    }
  } catch (e) {
    console.log(e);
  }
});
