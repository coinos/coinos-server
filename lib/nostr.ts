import config from "$config";
import { g, s } from "$lib/db";
import { l } from "$lib/logging";
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
  name: pubkey.substr(0, 6),
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
      } catch(e) {}
    });
  } catch(e) {
    warn("failed to send receipt", e.message);
  }
}

export const getRelays = async (pubkey): Promise<any> => {
  const { relays } = config;
  const filter = { authors: [pubkey], kinds: [10002] };
  const event = await pool.get([config.nostr], filter, opts);

  let read = relays;
  let write = relays;

  if (event) {
    read = [];
    write = [];
    for (const r of event.tags) {
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

export const getProfile = async (pubkey, relays = [config.nostr]) => {
  let profile = await g(`${pubkey}:profile`);

  if (!profile) {
    const pubkeys = [pubkey];
    let filter: any = { authors: pubkeys, kinds: [0] };

    let ev = await pool.get(relays, filter, opts);

    if (!ev) {
      ({ write: relays } = await getRelays(pubkey));
      ev = await pool.get(relays, filter, opts);
    }

    if (!ev) {
      filter = { cache: ["user_infos", { pubkeys }] };
      ev = (await pool.querySync([config.cache], filter, opts)).find(
        (e) => e.kind === 0,
      );
    }

    if (ev) {
      send(ev);
      profile = JSON.parse(ev.content);
    } else {
      profile = anon(pubkey);
    }
  }

  await s(`${pubkey}:profile`, profile);
  return profile;
};

export const getCount = async (pubkey) => {
  let follows = await g(`${pubkey}:follows:n`);
  let followers = await g(`${pubkey}:followers:n`);

  if (follows === null) {
    const filter: any = { kinds: [3], authors: [pubkey] };
    let ev = await pool.get([config.nostr], filter, opts);

    if (!ev) {
      let { relays } = config;
      ({ write: relays } = await getRelays(pubkey));
      ev = await pool.get(relays, filter, opts);
      send(ev);
    }

    if (ev) {
      follows = ev.tags
        .map((t) => t[0] === "p" && t[1])
        .filter((p) => p && p.length === 64).length;
    }

    follows ||= 0;
    await s(`${pubkey}:follows:n`, follows);
  }

  if (followers === null) {
    const filter: any = { cache: ["user_infos", { pubkeys: [pubkey] }] };
    const infos = await pool.querySync([config.cache], filter, opts);

    const f = infos.find((e) => e.kind === 10000133);
    let counts = {};
    if (f?.content) {
      counts = JSON.parse(f.content);
      followers = counts[pubkey];
    }

    followers ||= 0;
    await s(`${pubkey}:followers:n`, followers);
  }

  return { follows, followers };
};
