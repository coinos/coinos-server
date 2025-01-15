import config from "$config";
import { db, g } from "$lib/db";
import {
  anon,
  getCount,
  getProfile,
  getRelays,
  send,
  serverPubkey,
} from "$lib/nostr";
import { scan } from "$lib/strfry";
import { bail, fail, fields, getUser } from "$lib/utils";
import { decode } from "nostr-tools/nip19";
import type { ProfilePointer } from "nostr-tools/nip19";

export default {
  async event(req, res) {
    const {
      params: { id },
    } = req;
    const event = await g(`ev:${id}`);
    if (!event) return bail(res, "event not found");

    const { pubkey } = event;

    event.user = (await g(`user:${pubkey}`)) || anon(pubkey);

    res.send(event);
  },

  async publish(req, res) {
    try {
      const { event } = req.body;
      const { pubkey } = req.user;
      const { write: relays } = await getRelays(pubkey);
      if (!relays.includes(config.nostr)) relays.push(config.nostr);

      let ok;
      for (const url of relays) {
        try {
          await send(event, url);
          ok = true;
        } catch (e) {
          console.log("failed to publish to", url);
        }
      }

      if (!ok) fail("failed to publish");
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
      const pubkeys = event.tags
        .filter((tag) => tag[0] === "p")
        .map((tag) => tag[1])
        .slice(offset, limit);

      let follows = [];
      if (pubkeysOnly) follows = pubkeys;
      else {
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
      names = { [name]: (await getUser(name)).pubkey };
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
};
