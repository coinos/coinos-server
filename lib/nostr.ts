import config from "$config";
import { db, g, s } from "$lib/db";
import { l, warn } from "$lib/logging";
import { scan } from "$lib/strfry";
import { fail, fields, getUser, pick } from "$lib/utils";
import { finalizeEvent, getPublicKey, nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { AbstractSimplePool } from "nostr-tools/abstract-pool";
import { Relay } from "nostr-tools/relay";

export const EX = 60 * 60 * 24;
const coinos = await Relay.connect(config.nostr);

export const serverPubkey = getPublicKey(
  nip19.decode(config.nostrKey).data as Uint8Array,
);

const alwaysTrue: any = (t: Event) => {
  t[Symbol("verified")] = true;
  return true;
};
export const pool = new AbstractSimplePool({ verifyEvent: alwaysTrue });
const opts = { maxWait: 2000 };

export const anon = (pubkey) => ({
  username: pubkey.substr(0, 6),
  pubkey,
  anon: true,
  follows: [],
  followers: [],
});

export async function send(ev, url = config.nostr) {
  if (!ev?.id) return;
  const r = await Relay.connect(url);
  await r.publish(ev);
  r.close();
}

export async function handleZap(invoice, sender = undefined) {
  try {
    const pubkey = serverPubkey;
    const sk = nip19.decode(config.nostrKey).data as Uint8Array;
    const zapreq = JSON.parse(invoice.description);

    if (!zapreq.tags || zapreq.tags.length === 0) {
      fail("No tags found");
    }

    const ptags = zapreq.tags.filter(
      (t) => t?.length && t.length >= 2 && t[0] === "p",
    );

    if (ptags.length !== 1) {
      fail("None or multiple p tags found");
    }

    const etags = zapreq.tags.filter(
      (t) => t?.length && t.length >= 2 && t[0] === "e",
    );

    if (!(etags.length === 0 || etags.length === 1)) {
      fail("Expected none or 1 e tags");
    }

    const atags = zapreq.tags.filter(
      (t) => t?.length && t.length >= 2 && t[0] === "a",
    );

    const relays_tag = zapreq.tags.find(
      (t) => t?.length && t.length >= 2 && t[0] === "relays",
    );

    if (!relays_tag) {
      fail("No relays tag found");
    }

    const relays = relays_tag.slice(1).filter((r) => r?.startsWith("ws"));
    const etag = etags.length > 0 && etags[0];
    const atag = atags.length > 0 && atags[0];
    const ptag = ptags[0];

    const kind = 9735;
    const created_at = invoice.paid_at;
    const content = zapreq.content;

    const tags = [ptag];
    if (etag) tags.push(etag);
    if (atag) tags.push(atag);
    if (sender) tags.push(["P", zapreq.pubkey]);

    tags.push(["bolt11", invoice.bolt11]);
    tags.push(["description", invoice.description]);
    tags.push(["preimage", invoice.payment_preimage]);

    const ev = { pubkey, kind, created_at, content, tags };
    const signed = await finalizeEvent(ev, sk);

    l("sending receipt");

    relays.map(async (url) => {
      try {
        const r = await Relay.connect(url);
        await r.publish(signed);
        setTimeout(() => r.close(), 1000);
      } catch (e) {}
    });
  } catch (e) {
    warn("failed to send receipt", e.message);
  }
}

export const getRelays = async (pubkey): Promise<any> => {
  const { relays } = config;
  const filter = { authors: [pubkey], kinds: [10002] };
  const result = await scan(filter);

  let read = relays;
  let write = relays;

  if (result.length) {
    const { tags } = result[0];
    read = [];
    write = [];
    for (const r of tags) {
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

export const getProfile = async (pubkey) => {
  let profile = await g(`profile:${pubkey}`);
  if (profile) return profile;

  const event = await get({ authors: [pubkey], kinds: [0] });

  if (event) {
    profile = JSON.parse(event.content);
  } else {
    profile = anon(pubkey);
  }

  await db.set(`profile:${pubkey}`, JSON.stringify(profile), { EX });

  return profile;
};

export const getCount = async (pubkey) => {
  try {
    let follows = await g(`${pubkey}:follows:n`);

    if (follows === null) {
      const result = await get({ authors: [pubkey], kinds: [3] });
      follows = result ? result.tags.filter((t) => t[0] === "p").length : 0;
      if (follows?.length)
        await db.set(`${pubkey}:follows:n`, JSON.stringify(follows), { EX });
    }

    const k = `${pubkey}:followers:n`;
    let followers = await g(k);

    if (followers === null) {
      [followers] = await count({
        "#p": [pubkey],
        kinds: [3],
      });

      if (followers?.length) await db.set(k, JSON.stringify(followers), { EX });
    }

    return { follows, followers };
  } catch (e) {
    console.log(e);
  }
};

export const getNostrUser = async (key) => {
  let user = await getUser(key);

  if (key.length === 64) {
    const nostr: any = await getProfile(key);
    if (nostr) {
      nostr.username = nostr.name || key.substr(0, 6);
      nostr.display = nostr.display_name || nostr.displayName;
      nostr.display_name = undefined;
      nostr.displayName = undefined;
      nostr.name = undefined;
    }

    if (user) {
      user.anon = false;
      nostr.display = undefined;
    }

    user = {
      ...nostr,
      currency: "USD",
      pubkey: key,
      anon: true,
      ...user,
    };
  }

  if (!user) fail("User not found");

  if (user.pubkey) user.npub = nip19.npubEncode(user.pubkey);
  user.prompt = !!user.prompt;

  return pick(user, fields);
};

export const q = async (f) => {
  let events = (await scan(f)) as Event[];
  const k = JSON.stringify(f).replace(/[^a-zA-Z0-9]/g, "");
  const since = await g(`${k}:since}`);
  if (since) f.since = since;

  const p = new Promise((resolve) => {
    const r = [];
    pool.subscribeMany(["wss://relay.primal.net"], [f], {
      onevent(e) {
        r.push(e);
        coinos.publish(e);
      },
      oneose() {
        resolve(r);
      },
    });
  });

  if (events.length) return events;
  events = (await p) as Event[];
  if (events.length) db.set(`${k}:since`, events[events.length - 1].created_at);
  return events;
};

export const get = async (f) => {
  f.limit = 1;
  const events = await q(f);
  return events[0];
};
