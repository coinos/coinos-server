import config from "$config";
import { db } from "$lib/db";
import { l } from "$lib/logging";
import { fail } from "$lib/utils";
import { nip19, finalizeEvent, getPublicKey } from "nostr-tools";
import { Relay } from "nostr-tools/relay";
import { SimplePool } from "nostr-tools";

export const serverPubkey = getPublicKey(
  nip19.decode(config.nostrKey).data as Uint8Array,
);

export let pool = new SimplePool();

export async function send(ev, url = config.nostr) {
  if (!(ev && ev.id)) return;
  try {
    let r = await Relay.connect(url);
    await r.publish(ev);
    r.close();
  } catch (e) {
    console.log("nostr send error", e);
  }
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
  let event = await pool.get([config.nostr], filter);

    let read = relays;
    let write = relays;

  if (event) {

    read = [];
    write = [];
    for (let r of event.tags) {
      if (!r[2] || r[2] === "write") write.push(r[1]);
      if (!r[2] || r[2] === "read") read.push(r[1]);
    }
  } else pool.get(relays, filter).then(send);

  return { read, write };
};

export let getProfile = async (pubkey) => {
  if (await db.sIsMember("noprofile", pubkey)) return;
  let relays = [config.nostr];
  let filter = { authors: [pubkey], kinds: [0] };
  let ev = await pool.get(relays, filter);
  if (ev) {
    return JSON.parse(ev.content);
  } else
    getRelays(pubkey).then(({ write: relays }) =>
      pool.get(relays, filter).then(send),
    );
};
