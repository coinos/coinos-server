import config from "$config";
import { g, s, db } from "$lib/db";
import { l } from "$lib/logging";
import { fail } from "$lib/utils";
import { nip19, finalizeEvent, getPublicKey } from "nostr-tools";
import { Relay } from "nostr-tools/relay";
import { AbstractSimplePool } from "nostr-tools/abstract-pool";

export const serverPubkey = getPublicKey(
  nip19.decode(config.nostrKey).data as Uint8Array,
);

let alwaysTrue: any = (t: Event) => {
  t[Symbol("verified")] = true;
  return true;
};
export let pool = new AbstractSimplePool({ verifyEvent: alwaysTrue });
let opts = { maxWait: 2000 };

export async function send(ev, url = config.nostr) {
  if (!(ev && ev.id)) return;
  let r = await Relay.connect(url);
  await r.publish(ev);
  r.close();
}

export async function handleZap(invoice) {
  let pubkey = serverPubkey;
  let sk = nip19.decode(config.nostrKey).data as Uint8Array;
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
  let signed = await finalizeEvent(ev, sk);

  l("sending receipt");

  await Promise.allSettled(
    relays.map(async (url) => {
      let r = await Relay.connect(url);
      await r.publish(signed);
      r.close();
    }),
  );
}

export let getRelays = async (pubkey): Promise<any> => {
  let { relays } = config;
  let filter = { authors: [pubkey], kinds: [10002] };
  let event = await pool.get([config.nostr], filter, opts);

  let read = relays;
  let write = relays;

  if (event) {
    read = [];
    write = [];
    for (let r of event.tags) {
      if (r[0] !== "r") continue;
      if (!r[2] || r[2] === "write") write.push(r[1]);
      if (!r[2] || r[2] === "read") read.push(r[1]);
    }
  } else
    pool
      .get(relays, filter)
      .then(send)
      .catch(() => {});

  return { read, write };
};

export let getProfile = async (pubkey) => {
  let noprofile = await db.sIsMember("noprofile", pubkey);
  if (noprofile) return;
  let pubkeys = [pubkey];
  let relays = [config.nostr];
  let filter: any = { authors: pubkeys, kinds: [0] };

  let ev = await pool.get(relays, filter, opts);

  if (!ev) {
    filter = { cache: ["user_infos", { pubkeys }] };
    ev = (await pool.querySync([config.cache], filter, opts)).find(
      (e) => e.kind === 0,
    );
  }

  if (!ev) {
    ({ write: relays } = await getRelays(pubkey));
    ev = await pool.get(relays, filter, opts);
  }

  if (ev) {
    send(ev);
    return JSON.parse(ev.content);
  } else return anon(pubkey);
};

export let anon = (pubkey) => ({
  name: pubkey.substr(0, 6),
  pubkey,
  anon: true,
  follows: [],
  followers: [],
});

export let getCount = async (pubkey) => {
  let created_at;
  let filter: any = { kinds: [3], authors: [pubkey] };
  let ev = await pool.get([config.nostr], filter, opts);

  if (!ev) {
    let { relays } = config;
    ({ write: relays } = await getRelays(pubkey));

    filter = { kinds: [3], authors: [pubkey] };
    ev = await pool.get(relays, filter, opts);
    send(ev);
  }

  if (ev) ({ created_at } = ev);

  let follows = 0;
  let cache = await g(`${pubkey}:follows:n`);
  if (cache && cache.t >= created_at) ({ follows } = cache);
  else {
    if (ev)
      follows = ev.tags
        .map((t) => t[0] === "p" && t[1])
        .filter((p) => p && p.length === 64).length;
    await s(`${pubkey}:follows:n`, { follows, t: created_at });
  }

  filter = { kinds: [3], "#p": [pubkey] };
  ev = await pool.get([config.nostr], filter, opts);
  if (ev) ({ created_at } = ev);

  let followers = 0;
  cache = await g(`${pubkey}:followers:n`);

  if (cache && cache.t >= created_at) ({ followers } = cache);
  else {
    let filter: any = { cache: ["user_infos", { pubkeys: [pubkey] }] };
    let infos = await pool.querySync([config.cache], filter, opts);

    let f = infos.find((e) => e.kind === 10000133);
    let counts = {};
    if (f && f.content) {
      counts = JSON.parse(f.content);
      followers = counts[pubkey];
      await s(`${pubkey}:followers:n`, { followers, t: created_at });
    }
  }

  return { follows, followers };
};
