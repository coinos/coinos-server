import config from "$config";
import { db } from "$lib/db";
import ln from "$lib/ln";
import {
  anon,
  get,
  getCount,
  getNostrUser,
  getProfile,
  getRelays,
  q,
  send,
  serverPubkey,
} from "$lib/nostr";
import { parseContent } from "$lib/notes";
import { load, scan, sync } from "$lib/strfry";
import { bail, fail, fields, getUser } from "$lib/utils";
import got from "got";
import type { Event } from "nostr-tools";
import { verifyEvent } from "nostr-tools";
import { decode } from "nostr-tools/nip19";
import type { ProfilePointer } from "nostr-tools/nip19";
import { getZapEndpoint, makeZapRequest } from "nostr-tools/nip57";

export default {
  async event(req, res) {
    let { id } = req.params;
    if (id.startsWith("nevent")) id = decode(id).data.id;
    if (id.startsWith("note")) id = decode(id).data;
    const events = await q({ ids: [id] });

    if (!events.length) return bail(res, "event not found");

    res.send(events[0]);
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
        e.author = await getNostrUser(e.pubkey);
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
      // const { write: relays } = await getRelays(pubkey);
      // if (!relays.includes(config.nostr)) relays.push(config.nostr);
      if (!verifyEvent(event)) fail("Invalid event");
      await load(JSON.stringify(event));
      if (event.kind === 3) db.del(`${pubkey}:follows`);

      res.send({});
    } catch (e) {
      bail(res, e.message);
    }
  },

  async follows(req, res) {
    const {
      params: { pubkey },
      query: { limit = 20, offset = 0, pubkeysOnly },
    } = req;
    try {
      const events = await scan({ authors: [pubkey], kinds: [3] });
      if (!events.length) return res.send([]);

      const event = events[0];
      let pubkeys = event.tags
        .filter((tag) => tag[0] === "p")
        .map((tag) => tag[1]);

      let follows = [];
      if (pubkeysOnly) follows = pubkeys;
      else {
        pubkeys = pubkeys.slice(limit, offset);
        const profiles = await scan({ authors: pubkeys, kinds: [0] });
        for (const p of profiles) {
          const { content, pubkey } = p;
          let user = await getUser(pubkey, fields);
          user = { ...user, ...JSON.parse(content) };
          user.pubkey = pubkey;
          follows.push(user);
        }

        const keys = follows.map((f) => f.pubkey);
        const missing = await Promise.all(
          pubkeys
            .filter((p) => !keys.includes(p))
            .map(
              async (pubkey) => (await getUser(pubkey, fields)) || anon(pubkey),
            ),
        );

        follows.push(...missing);
      }

      res.send(follows);
    } catch (e) {
      console.log("follows fail", e);
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
        e.author = await getNostrUser(e.pubkey);
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

  async followers(req, res) {
    const {
      params: { pubkey },
      query: { limit = 20, offset = 0 },
    } = req;
    try {
      const filter = { kinds: [3], "#p": [pubkey] };
      const events = await scan({ ...filter, limit });
      if (!events.length) return res.send([]);

      const pubkeys = events.map((e) => e.pubkey).slice(offset, limit);

      const followers = [];
      const profiles = await scan({ authors: pubkeys, kinds: [0] });
      for (const p of profiles) {
        const { content, pubkey } = p;
        let user = await getUser(pubkey, fields);
        user = { ...user, ...JSON.parse(content) };
        user.pubkey = pubkey;
        followers.push(user);
      }

      const keys = followers.map((f) => f.pubkey);
      const missing = await Promise.all(
        pubkeys
          .filter((p) => !keys.includes(p))
          .map(
            async (pubkey) => (await getUser(pubkey, fields)) || anon(pubkey),
          ),
      );

      followers.push(...missing);

      res.send(followers);
    } catch (e) {
      console.log(e);
      bail(res, e.message);
    }
  },

  async count(req, res) {
    try {
      const { pubkey } = req.params;
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
        relays: [config.nostr],
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
