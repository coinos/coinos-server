import config from "$config";
import { bail, fail, getUser } from "$lib/utils";
import { g, s, db } from "$lib/db";
import {
  anon,
  send,
  getCount,
  getRelays,
  serverPubkey,
  pool,
} from "$lib/nostr";

let opts = { maxWait: 2000 };

export default {
  async event(req, res) {
    let {
      params: { id },
    } = req;
    let event = await g(`ev:${id}`);
    if (!event) return bail(res, "event not found");

    let { pubkey } = event;

    event.user = (await g(`user:${pubkey}`)) || anon(pubkey);

    res.send(event);
  },

  async publish(req, res) {
    try {
      let { event } = req.body;
      let { pubkey } = req.user;
      let { write: relays } = await getRelays(pubkey);
      if (!relays.includes(config.nostr)) relays.push(config.nostr);

      let ok;
      for (let url of relays) {
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
    let {
      params: { pubkey },
      query: { tagsonly },
    } = req;
    try {
      let filter = { kinds: [3], authors: [pubkey] };
      let ev = await pool.get([config.nostr], filter, opts);

      if (!ev || tagsonly) {
        let { relays } = config;
        ({ write: relays } = await getRelays(pubkey));

        filter = { kinds: [3], authors: [pubkey] };
        ev = await pool.get(relays, filter, opts);
        send(ev);
      }

      let created_at;
      let follows = [];
      let tags = [];

      if (ev) ({ created_at, tags } = ev);
      if (!tags.length || tagsonly) return res.send(tags);

      let cache = await g(`${pubkey}:follows`);
      if (cache && cache.t >= created_at) ({ follows } = cache);
      else {
        let pubkeys = tags
          .map((t) => t[0] === "p" && t[1])
          .filter((p) => p && p.length === 64);
        let filter: any = { cache: ["user_infos", { pubkeys }] };
        let infos = await pool.querySync([config.cache], filter, opts);
        let profiles = infos.filter((e) => e.kind === 0);

        let f = infos.find((e) => e.kind === 10000133);
        let counts = {};
        if (f) counts = JSON.parse(f.content);

        for (let p of profiles) {
          let { content, pubkey } = p;
          let user = JSON.parse(content);
          user.count = counts[pubkey];
          user.pubkey = pubkey;
          follows.push(user);
        }

        let followKeys = follows.map((f) => f.pubkey);
        let missing = pubkeys
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
    let {
      params: { pubkey },
    } = req;
    try {
      let filter: any = { kinds: [3], "#p": [pubkey] };
      let ev = await pool.get([config.nostr], filter, opts);
      let created_at;
      if (ev) ({ created_at } = ev);

      let followers = [];
      let cache = await g(`${pubkey}:followers`);
      if (cache && cache.t >= created_at) ({ followers } = cache);
      else {
        filter = { cache: ["user_followers", { pubkey }] };
        let data = await pool.querySync([config.cache], filter, opts);
        for (let ev of data.filter((f) => f.kind === 0)) {
          let { content, pubkey } = ev;
          let user = JSON.parse(content);
          user.pubkey = pubkey;
          followers.push(user);
        }

        let pubkeys = followers.map((f) => f.pubkey);
        filter = { cache: ["user_infos", { pubkeys }] };
        let infos = await pool.querySync([config.cache], filter, opts);

        let counts = {};
        let f = infos.find((e) => e.kind === 10000133);
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
      let { pubkey } = req.params;
      let count = await getCount(pubkey);
      res.send(count);
    } catch (e) {
      bail(res, e.message);
    }
  },

  async identities(req, res) {
    let {
      query: { name },
    } = req;
    let names = {};
    if (name) {
      names = { [name]: (await getUser(name)).pubkey };
    } else {
      let records = await db.sMembers("nip5");
      for (let s of records) {
        let [name, pubkey] = s.split(":");
        names[name] = pubkey;
      }
    }

    res.send({ names });
  },

  async info(_, res) {
    res.send({ pubkey: serverPubkey });
  },
};
