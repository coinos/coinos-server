import config from "$config";
import { db, g, s } from "$lib/db";
import { l } from "$lib/logging";
import { count, scan, sync } from "$lib/strfry";
import { fail } from "$lib/utils";
import { finalizeEvent, getPublicKey, nip19 } from "nostr-tools";
import { AbstractSimplePool } from "nostr-tools/abstract-pool";
import { Relay } from "nostr-tools/relay";

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

export async function handleZap(invoice) {
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

    const relays_tag = zapreq.tags.find(
      (t) => t?.length && t.length >= 2 && t[0] === "relays",
    );

    if (!relays_tag) {
      fail("No relays tag found");
    }

    const relays = relays_tag.slice(1).filter((r) => r?.startsWith("ws"));
    const etag = etags.length > 0 && etags[0];
    const ptag = ptags[0];

    const kind = 9735;
    const created_at = invoice.paid_at;
    const content = zapreq.content;

    const tags = [ptag];
    if (etag) tags.push(etag);

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

  const filter = { authors: [pubkey], kinds: [0] };
  const events = await scan(filter);

  if (events.length) {
    profile = JSON.parse(events[0].content);
  } else {
    profile = anon(pubkey);
  }

  await db.set(`profile:${pubkey}`, JSON.stringify(profile), { EX: 300 });

  return profile;
};

export const getCount = async (pubkey) => {
  try {
    const result = await scan({ authors: [pubkey], kinds: [3] });
    const follows = result.length
      ? result[0].tags.filter((t) => t[0] === "p").length
      : 0;

    const [followers] = await count({ "#p": [pubkey], kinds: [3] });
    return { follows, followers };
  } catch (e) {
    console.log(e);
  }
};
