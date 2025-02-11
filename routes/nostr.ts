import config from "$config";
import { db, g, s } from "$lib/db";
import ln from "$lib/ln";
import {
  EX,
  get,
  getCount,
  getNostrUser,
  getProfile,
  pool,
  publish,
  q,
  serverPubkey,
} from "$lib/nostr";
import { parseContent } from "$lib/notes";
import { scan } from "$lib/strfry";
import { bail, fail, fields, getUser } from "$lib/utils";
import got from "got";
import type { Event } from "nostr-tools";
import { decode } from "nostr-tools/nip19";
import type { ProfilePointer } from "nostr-tools/nip19";
import { getZapEndpoint, makeZapRequest } from "nostr-tools/nip57";

export default {
  async event(req, res) {
    try {
      let { id } = req.params;
      const full = req.url.endsWith("full");

      if (id.startsWith("nevent")) id = decode(id).data.id;
      if (id.startsWith("note")) id = decode(id).data;

      const k = `event:${id}${full ? ":full" : ""}`;
      let event = await g(k);
      if (event) return res.send(event);

      event = await get({ ids: [id] });
      if (!full) return res.send(event);

      const parts = parseContent(event);

      let pubkeys = parts
        .filter(
          ({ type }) => type.includes("nprofile") || type.includes("npub"),
        )
        .map(({ value }) => value.pubkey);

      const zapEvents = await scan({ kinds: [9735], "#e": [id] });
      const zaps = [];
      for (const { tags } of zapEvents) {
        const bolt11 = tags.find((t) => t[0] === "bolt11")?.[1];
        const description = tags.find((t) => t[0] === "description")?.[1];
        const { pubkey } = JSON.parse(description);
        let amount = 0;
        try {
          const { amount_msat } = await ln.decode(bolt11);
          if (amount_msat) amount = Math.round(amount_msat / 1000);
        } catch (e) {}

        zaps.push({ amount, pubkey });
      }

      pubkeys.push(event.pubkey);
      pubkeys.push(...zaps.map((z) => z.pubkey));
      pubkeys = [...new Set(pubkeys)];
      const profiles = await scan({ kinds: [0], authors: pubkeys });
      const found = profiles.map((p) => p.pubkey);
      const missing = pubkeys.filter((p) => !found.includes(p));

      const missingProfiles = (
        await pool.querySync(config.relays, {
          kinds: [0],
          authors: missing,
        })
      )
        .reduce((a, b) => {
          a.set(
            b.pubkey,
            b.created_at > (a.get(b.pubkey)?.created_at || 0)
              ? b
              : a.get(b.pubkey),
          );
          return a;
        }, new Map())
        .values();

      profiles.push(...missingProfiles);

      event.parts = parts;
      event.names = profiles.reduce((a, b) => {
        const { content } = b;
        const { name } = JSON.parse(content);
        a[b.pubkey] = name;
        return a;
      }, {});

      event.author = profiles.find((p) => p.pubkey === event.pubkey);

      event.zaps = zaps
        .filter((z) => z.amount > 0)
        .map(({ amount, pubkey }) => ({
          amount,
          user: profiles.find((p) => p.pubkey === pubkey),
        }));

      await db.set(k, JSON.stringify(event), { EX });

      res.send(event);
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async parse(req, res) {
    const { event } = req.body;
    const parts = parseContent(event);
    const names = {};

    for (const { type, value } of parts) {
      if (type.includes("nprofile") || type.includes("npub")) {
        const { name } = await getProfile(value.pubkey);
        names[value.pubkey] = name;
      }
    }

    res.send({ parts, names });
  },

  async thread(req, res) {
    try {
      const { id } = req.params;

      const event = await get({ ids: [id] });

      const rootId = event.tags.find(
        (tag) => tag[0] === "e" && tag[3] === "root",
      )?.[1];

      let root;
      if (rootId) root = await get({ ids: [rootId] });
      else root = event;

      const thread = [root, ...(await q({ kinds: [1], "#e": [root.id] }))];

      for (const t of thread) {
        const e = t as any;
        e.author = await getProfile(e.pubkey);
        e.parts = parseContent(e);
        e.names = {};
        for (const { type, value } of e.parts) {
          if (type.includes("nprofile") || type.includes("npub")) {
            const { name } = await getProfile(value.pubkey);
            e.names[value.pubkey] = name;
          }
        }
      }

      res.send(thread);
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async zaps(req, res) {
    try {
      let { id } = req.params;
      if (id.startsWith("nevent")) id = decode(id).data.id;
      if (id.startsWith("note")) id = decode(id).data;
      const filter = { kinds: [9735], "#e": [id] };
      let events = await scan(filter);
      if (!events.length) {
        await sync("wss://relay.primal.net", filter);
        events = await scan(filter);
      }
      if (!events.length) return res.send([]);

      const zaps = [];
      for (const { tags } of events) {
        const bolt11 = tags.find((t) => t[0] === "bolt11")?.[1];
        const description = tags.find((t) => t[0] === "description")?.[1];
        const { pubkey } = JSON.parse(description);
        let amount = 0;
        try {
          const { amount_msat } = await ln.decode(bolt11);
          if (amount_msat) amount = Math.round(amount_msat / 1000);
        } catch (e) {}

        let user;
        if (pubkey) {
          try {
            user = await getNostrUser(pubkey);
            zaps.push({ amount, user });
          } catch (e) {}
        }
      }

      res.send(zaps.filter((z) => z.amount > 0));
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async publish(req, res) {
    try {
      const { event } = req.body;
      const { pubkey } = req.user;

      await publish(event);

      if (event.kind === 3) {
        db.del(`${pubkey}:follows`);
        db.del(`${pubkey}:follows:n`);
      }

      res.send({});
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async events(req, res) {
    const {
      params: { pubkey },
    } = req;
    try {
      const events = await q({ kinds: [1], authors: [pubkey], limit: 20 });

      for (const v of events) {
        const e = v as any;
        e.author = await getProfile(e.pubkey);
        e.parts = parseContent(e);
        e.names = {};
        for (const { type, value } of e.parts) {
          if (type.includes("nprofile") || type.includes("npub")) {
            const { name } = await getProfile(value.pubkey);
            e.names[value.pubkey] = name;
          }
        }
      }

      res.send(events);
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async follows(req, res) {
    const {
      params: { pubkey },
      query: { limit = 20, offset = 0, pubkeysOnly },
    } = req;
    try {
      const k = `${pubkey}:follows${pubkeysOnly ? ":pubkeys" : ""}`;
      let follows = await g(k);
      if (follows?.length) return res.send(follows);

      const event = await get({ authors: [pubkey], kinds: [3] });
      if (!event) return res.send([]);

      let pubkeys = event.tags
        .filter((tag) => tag[0] === "p")
        .map((tag) => tag[1]);

      follows = [];
      if (pubkeysOnly) follows = pubkeys;
      else {
        pubkeys = pubkeys.slice(offset, offset + limit);
        follows = (
          await Promise.allSettled(
            pubkeys.map(async (pubkey) => ({
              ...(await getProfile(pubkey)),
              pubkey,
            })),
          )
        )
          .filter((r) => r.status === "fulfilled")
          .map((r) => r.value);
      }

      await db.set(k, JSON.stringify(follows), { EX });

      res.send(follows);
    } catch (e) {
      console.log("follows fail", e);
      bail(res, e.message);
    }
  },

  async followers(req, res) {
    const {
      params: { pubkey },
      query: { limit = 20, offset = 0 },
    } = req;
    try {
      let followers = await g(`${pubkey}:followers`);
      if (followers?.length) return res.send(followers);

      const events = await q({ kinds: [3], "#p": [pubkey], limit });
      if (!events.length) return res.send([]);

      const pubkeys = events.map((e) => e.pubkey).slice(offset, offset + limit);
      followers = (
        await Promise.allSettled(
          pubkeys.map(async (pubkey) => ({
            ...(await getProfile(pubkey)),
            pubkey,
          })),
        )
      )
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);

      await db.set(`${pubkey}:followers`, JSON.stringify(followers), { EX });

      res.send(followers);
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async count(req, res) {
    try {
      const { pubkey } = req.params;
      // res.send({ followers: 0, follows: 0 });
      res.send(await getCount(pubkey));
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async identities(req, res) {
    const {
      query: { name },
    } = req;
    let names = {};
    if (name) {
      names = { [name]: (await getUser(name, fields)).pubkey };
    } else {
      const records = await db.sMembers("nip5");
      for (const s of records) {
        const [name, pubkey] = s.split(":");
        names[name] = pubkey;
      }
    }

    res.send({ names });
  },

  async info(_, res) {
    res.send({ pubkey: serverPubkey });
  },

  async profile(req, res) {
    const { profile } = req.params;
    const { data } = decode(profile);
    const { pubkey, relays } = data as ProfilePointer;
    const recipient = await getProfile(pubkey, relays);
    recipient.relays = relays;
    res.send(recipient);
  },

  async zapRequest(req, res) {
    try {
      const { amount, id } = req.body;
      const { pubkey } = await get({ ids: [id] });
      const event = await makeZapRequest({
        profile: pubkey,
        event: id,
        amount: amount * 1000,
        relays: ["wss://relay.coinos.io", "wss://relay.primal.net"],
        comment: "",
      });

      res.send(event);
    } catch (e) {
      console.log(e);
    }
  },

  async zap(req, res) {
    try {
      const { event } = req.body;
      const amount = event.tags.find((t) => t[0] === "amount")[1];
      const pubkey = event.tags.find((t) => t[0] === "p")[1];
      const content = JSON.stringify(await getProfile(pubkey));
      const callback = await getZapEndpoint({ content } as Event);
      if (!callback || callback === "null") fail("Lightning address not found");

      const encodedEvent = encodeURI(JSON.stringify(event));
      const url = `${callback}?amount=${amount}&nostr=${encodedEvent}`;
      const json = await got(url).json();

      res.send(json);
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },
};
