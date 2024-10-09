import config from "$config";
import { bail, chunk, getUser, uniq } from "$lib/utils";
import { g, s, db } from "$lib/db";
import { anon, send, getRelays, serverPubkey, pool } from "$lib/nostr";

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

  async follows(req, res) {
    let {
      params: { pubkey },
      query: { tagsonly },
    } = req;
    try {
      let filter = { kinds: [3], authors: [pubkey] };
      let ev = await pool.get([config.nostr], filter);

      if (!ev) {
        let { relays } = config;
        ({ write: relays } = await getRelays(pubkey));

        filter = { kinds: [3], authors: [pubkey] };
        pool.get(relays, filter).then(send);
      }

      let created_at;
      let follows = [];
      let tags = [];
      if (ev) ({ created_at, tags } = ev);
      if (!tags.length || tagsonly) return res.send(tags);

      let cache = await g(`${pubkey}:follows`);
      if (cache && cache.t >= created_at) ({ follows } = cache);
      else {
        let pubkeys = tags.map((t) => t[1]).filter((p) => p.length === 64);
        let filter: any = { cache: ["user_infos", { pubkeys }] };
        let infos = await pool.querySync([config.cache], filter);
        let profiles = infos.filter((e) => e.kind === 0);

        let f = infos.find((e) => e.kind === 10000133);
        let followers = {};
        if (f) followers = JSON.parse(f.content);

        for (let p of profiles) {
          let { content, pubkey } = p;
          let user = JSON.parse(content);
          user.followers = followers[pubkey];
          user.pubkey = pubkey;
          follows.push(user);
        }

        let followKeys = follows.map((f) => f.pubkey);
        let missing = pubkeys
          .filter((p) => !followKeys.includes(p))
          .map((pubkey) => anon(pubkey));

        follows.sort((a: any, b: any) => b.followers - a.followers);
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
      let pubkeys: any = await q({ "#p": [pubkey] });
      pubkeys = pubkeys.map((e) => e.pubkey);

      let followers: any = await q({ authors: [pubkeys], kinds: [0] });

      followers = uniq(followers, (e) => e.pubkey);
      followers.sort(
        (a, b) => a.username && a.username.localeCompare(b.username),
      );

      res.send(followers);
    } catch (e) {
      console.log(e);
      res.code(500).send(e && e.message);
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
