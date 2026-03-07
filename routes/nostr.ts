import { db, g } from "$lib/db";
import ln from "$lib/ln";
import { getMlsUsers } from "$lib/mls";
import {
  EX,
  get,
  getCount,
  getNostrUser,
  getProfile,
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

import { getZapEndpoint, makeZapRequest } from "nostr-tools/nip57";

export default {
  async mlsUsers(c) {
    try {
      return c.json(await getMlsUsers());
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async event(c) {
    try {
      let id = c.req.param("id");
      const full = c.req.url.endsWith("full");

      if (id.startsWith("nevent")) id = decode(id).data.id;
      if (id.startsWith("note")) id = decode(id).data;

      const k = `event:${id}${full ? ":full" : ""}`;
      let event = await g(k);
      if (event) return c.json(event);

      event = await get({ ids: [id] });
      if (!full) return c.json(event);

      const parts = parseContent(event);

      let pubkeys = parts
        .filter(({ type }) => type.includes("nprofile") || type.includes("npub"))
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
        await q({
          kinds: [0],
          authors: missing,
        })
      )
        .reduce((a, b) => {
          a.set(b.pubkey, b.created_at > (a.get(b.pubkey)?.created_at || 0) ? b : a.get(b.pubkey));
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

      return c.json(event);
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async parse(c) {
    const body = await c.req.json();
    const { event } = body;
    const parts = parseContent(event);
    const names = {};

    for (const { type, value } of parts) {
      if (type.includes("nprofile") || type.includes("npub")) {
        const { name } = await getProfile(value.pubkey);
        names[value.pubkey] = name;
      }
    }

    return c.json({ parts, names });
  },

  async thread(c) {
    try {
      const id = c.req.param("id");

      const event = await get({ ids: [id] });

      const rootId = event.tags.find((tag) => tag[0] === "e" && tag[3] === "root")?.[1];

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

      return c.json(thread);
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async zaps(c) {
    try {
      let id = c.req.param("id");
      if (id.startsWith("nevent")) id = decode(id).data.id;
      if (id.startsWith("note")) id = decode(id).data;
      const filter = { kinds: [9735], "#e": [id] };
      let events = await scan(filter);
      if (!events.length) {
        // @ts-ignore
        await (sync as any)("wss://relay.primal.net", filter);
        events = await scan(filter);
      }
      if (!events.length) return c.json([]);

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

      return c.json(zaps.filter((z) => z.amount > 0));
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async publish(c) {
    try {
      const body = await c.req.json();
      const { event } = body;
      const user = c.get("user");
      const { pubkey } = user;

      await publish(event);

      if (event.kind === 3) {
        db.del(`${pubkey}:follows`);
        db.del(`${pubkey}:follows:n`);
      }

      return c.json({});
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async events(c) {
    const pubkey = c.req.param("pubkey");
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

      return c.json(events);
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async follows(c) {
    const pubkey = c.req.param("pubkey");
    const limit = parseInt(c.req.query("limit") || "20");
    const offset = parseInt(c.req.query("offset") || "0");
    const pubkeysOnly = c.req.query("pubkeysOnly");
    try {
      const k = `${pubkey}:follows${pubkeysOnly ? ":pubkeys" : ""}`;
      let follows = await g(k);
      if (follows?.length) return c.json(follows);

      const event = await get({ authors: [pubkey], kinds: [3] });
      if (!event) return c.json([]);

      let pubkeys = event.tags.filter((tag) => tag[0] === "p").map((tag) => tag[1]);

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

      return c.json(follows);
    } catch (e) {
      console.log("follows fail", e);
      return bail(c, e.message);
    }
  },

  async followers(c) {
    const pubkey = c.req.param("pubkey");
    const limit = parseInt(c.req.query("limit") || "20");
    const offset = parseInt(c.req.query("offset") || "0");
    try {
      let followers = await g(`${pubkey}:followers`);
      if (followers?.length) return c.json(followers);

      const events = await q({ kinds: [3], "#p": [pubkey], limit });
      if (!events.length) return c.json([]);

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

      return c.json(followers);
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async count(c) {
    try {
      const pubkey = c.req.param("pubkey");
      return c.json(await getCount(pubkey));
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },

  async identities(c) {
    const name = c.req.query("name");
    let names = {};
    if (name) {
      names = { [name]: (await getUser(name, fields)).pubkey };
    } else {
      const records = await db.sMembers("nip5");
      for (const s of records) {
        const [name, pubkey] = (s as string).split(":");
        names[name] = pubkey;
      }
    }

    return c.json({ names });
  },

  async info(c) {
    return c.json({ pubkey: serverPubkey });
  },

  async profile(c) {
    const profile = c.req.param("profile");
    const { data } = decode(profile);
    const { pubkey, relays } = data as any;
    const recipient = await (getProfile as any)(pubkey, relays);
    recipient.relays = relays;
    return c.json(recipient);
  },

  async zapRequest(c) {
    try {
      const body = await c.req.json();
      const { amount, id } = body;
      const { pubkey } = await get({ ids: [id] });
      const event = await (makeZapRequest as any)({
        profile: pubkey,
        event: id,
        amount: amount * 1000,
        relays: ["wss://relay.coinos.io", "wss://relay.primal.net"],
        comment: "",
      });

      return c.json(event);
    } catch (e) {
      console.log(e);
    }
  },

  async zap(c) {
    try {
      const body = await c.req.json();
      const { event } = body;
      const amount = event.tags.find((t) => t[0] === "amount")[1];
      const pubkey = event.tags.find((t) => t[0] === "p")[1];
      const content = JSON.stringify(await getProfile(pubkey));
      const callback = await getZapEndpoint({ content } as Event);
      if (!callback || callback === "null") fail("Lightning address not found");

      const encodedEvent = encodeURI(JSON.stringify(event));
      const url = `${callback}?amount=${amount}&nostr=${encodedEvent}`;
      const json = await got(url).json();

      return c.json(json);
    } catch (e) {
      console.log(e);
      return bail(c, e.message);
    }
  },
};
