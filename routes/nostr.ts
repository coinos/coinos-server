import config from "$config";
import { bail, fail, getUser, time } from "$lib/utils";
import { g, s, db } from "$lib/db";
import {
  anon,
  send,
  getCount,
  getRelays,
  serverPubkey,
  pool,
} from "$lib/nostr";

const opts = { maxWait: 2000 };

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
      query: { pubkeysOnly, nocache },
    } = req;
    try {
      let created_at;
      let follows = [];

      let pubkeys = await g(`${pubkey}:pubkeys`);
      if (!pubkeys || !pubkeysOnly || nocache) {
        let filter = { kinds: [3], authors: [pubkey] };
        let ev = await pool.get([config.nostr], filter, opts);

        if (!ev) {
          let { relays } = config;
          ({ write: relays } = await getRelays(pubkey));

          filter = { kinds: [3], authors: [pubkey] };
          ev = await pool.get(relays, filter, opts);
          send(ev);
        }

        let tags = [];

        if (ev) ({ created_at, tags } = ev);
        pubkeys = tags
          .map((t) => t[0] === "p" && t[1])
          .filter((p) => p && p.length === 64);

        await s(`${pubkey}:pubkeys`, pubkeys);
      }
      if (!pubkeys.length || pubkeysOnly) return res.send(pubkeys);

      const cache = await g(`${pubkey}:follows`);
      if (cache && cache.t >= created_at) ({ follows } = cache);
      else {
        const filter: any = { cache: ["user_infos", { pubkeys }] };
        const infos = await pool.querySync([config.cache], filter, opts);
        const profiles = infos.filter((e) => e.kind === 0);

        const f = infos.find((e) => e.kind === 10000133);
        let counts = {};
        if (f) counts = JSON.parse(f.content);

        for (const p of profiles) {
          const { content, pubkey } = p;
          const user = JSON.parse(content);
          user.count = counts[pubkey];
          user.pubkey = pubkey;
          follows.push(user);
        }

        const followKeys = follows.map((f) => f.pubkey);
        const missing = pubkeys
          .filter((p) => !followKeys.includes(p))
          .map((pubkey) => anon(pubkey));

        follows.sort((a: any, b: any) => b.count - a.count);
        follows.push(...missing);

        s(`${pubkey}:follows`, { follows, t: created_at });
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
    } = req;
    try {
      let filter: any = { kinds: [3], "#p": [pubkey] };
      const ev = await pool.get([config.nostr], filter, opts);
      let created_at;
      if (ev) ({ created_at } = ev);

      let followers = [];
      const cache = await g(`${pubkey}:followers`);
      if (cache && cache.t >= created_at) ({ followers } = cache);
      else {
        filter = { cache: ["user_followers", { pubkey }] };
        const data = await pool.querySync([config.cache], filter, opts);
        for (const ev of data.filter((f) => f.kind === 0)) {
          const { content, pubkey } = ev;
          const user = JSON.parse(content);
          user.pubkey = pubkey;
          followers.push(user);
        }

        const pubkeys = followers.map((f) => f.pubkey);
        filter = { cache: ["user_infos", { pubkeys }] };
        const infos = await pool.querySync([config.cache], filter, opts);

        let counts = {};
        const f = infos.find((e) => e.kind === 10000133);
        if (f) counts = JSON.parse(f.content);
        followers.map((f) => (f.count = counts[f.pubkey]));
        followers.sort((a: any, b: any) => b.count - a.count);

        await s(`${pubkey}:followers`, { followers, t: created_at });
      }

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
};
