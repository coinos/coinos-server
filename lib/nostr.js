import config from "$config";
import { l } from "$lib/logging";
import { Relay, RelayPool, calculateId, signId, getPublicKey } from "nostr";
import { broadcast, emit } from "$lib/sockets";
import store from "$lib/store";
import { g, s, db } from "$lib/db";
import { fail, nada, wait } from "$lib/utils";
import { nip19 } from "nostr-tools";

export const COINOS_PUBKEY = getPublicKey(nip19.decode(config.nostrKey).data);
export let coinos;
export let pool;

export let fillPool = () => {
  pool = RelayPool(config.relays);
  pool.on("open", (relay) => {
    if (relay.url.includes(config.nostr)) coinos = relay;
    relay.subscribe("live", { limit: 1 });
  });

  pool.on("event", async (relay, sub, ev) => {
    if (!coinos) return;
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

          if (ev.kind === 4) {
            let uid = await g(`user:${ev.tags[0][1]}`);
            if (uid) ev.recipient = await g(`user:${uid}`);
            ev.author = ev.user;
            emit(uid, "event", ev);
          }
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
          updated: ev.created_at,
        };

        await s(`user:${pubkey}`, JSON.stringify(user));
      } else if (sub.includes("messages")) {
        let pubkey = sub.split(":")[0];
        await db.sAdd(`${pubkey}:messages`, ev.id);
        await s(`ev:${ev.id}`, ev);
      } else if (sub.includes("follows")) {
        let pubkey = sub.split(":")[0];
        await s(`${pubkey}:follows`, ev.tags);
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
        await s(`ev:${ev.id}`, ev);
      }
    } catch (e) {
      console.log(e);
    }
  });
};

let now = () => Math.round(Date.now() / 1000);

let timeouts = {};
export let q = async (
  sub,
  query,
  { timeout = 20000, since = 3600, eager = 200 },
) =>
  new Promise(async (r, j) => {
    let start = Date.now();
    let seen = [];
    let rejected;
    // query.since = await g(`since:${sub}`);
    // if (now() - query.since < since) return r();

    let done = { [sub]: [] };

    let check = (s) => {
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
      timer: undefined,
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

let getUser = async (pubkey) => {
  let id = await g(`user:${pubkey}`);
  let user = await g(`user:${id}`);
  return (
    user || {
      username: pubkey.substr(0, 6),
      pubkey,
      anon: true,
    }
  );
};

function send(ev, url, opts) {
  let timeout = (opts && opts.timeout != null && opts.timeout) || 1000;

  return new Promise((resolve, reject) => {
    let relay = Relay(url);

    function timeout_reached() {
      relay.close();
      reject(new Error("Request timeout"));
    }

    let timer = setTimeout(timeout_reached, timeout);

    relay.on("open", () => {
      clearTimeout(timer);
      timer = setTimeout(timeout_reached, timeout);
      relay.send(["EVENT", ev]);
    });

    relay.on("ok", (evid, ok, msg) => {
      clearTimeout(timer);
      relay.close();
      resolve({ evid, ok, msg });
    });
  });
}

export async function handleZap(invoice) {
  let { data: privkey } = nip19.decode(config.nostrKey);
  let pubkey = getPublicKey(privkey);
  let keypair = { privkey, pubkey };
  let zapreq = JSON.parse(invoice.description);

  if (!zapreq.tags || zapreq.tags.length === 0) {
    fail(`No tags found`);
  }

  let ptags = zapreq.tags.filter(
    (t) => t && t.length && t.length >= 2 && t[0] === "p",
  );

  if (ptags.length !== 1) {
    fail(`None or multiple p tags found`);
  }

  let etags = zapreq.tags.filter(
    (t) => t && t.length && t.length >= 2 && t[0] === "e",
  );

  if (!(etags.length === 0 || etags.length === 1)) {
    fail(`Expected none or 1 e tags`);
  }

  let relays_tag = zapreq.tags.find(
    (t) => t && t.length && t.length >= 2 && t[0] === "relays",
  );

  if (!relays_tag) {
    fail(`No relays tag found`);
  }

  let relays = relays_tag.slice(1).filter((r) => r && r.startsWith("ws"));
  let etag = etags.length > 0 && etags[0];
  let ptag = ptags[0];

  let kind = 9735;
  let created_at = invoice.paid_at;
  let content = zapreq.content;

  let tags = [ptag];
  if (etag) tags.push(etag);

  tags.push(["bolt11", invoice.bolt11]);
  tags.push(["description", invoice.description]);
  tags.push(["preimage", invoice.payment_preimage]);

  let ev = { pubkey, kind, created_at, content, tags };
  ev.id = await calculateId(ev);
  ev.sig = await signId(privkey, ev.id);

  l("sending receipt");

  await Promise.allSettled(relays.map((r) => send(ev, r)));
}
