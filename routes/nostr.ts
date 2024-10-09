import config from "$config";
import { bail, chunk, getUser, uniq } from "$lib/utils";
import { g, s, db } from "$lib/db";
import { send, getRelays, serverPubkey, pool } from "$lib/nostr";

let anon = (pubkey) => ({
  username: pubkey.substr(0, 6),
  pubkey,
  anon: true,
  follows: [],
  followers: [],
});

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
      let { relays } = config;
      ({ write: relays } = await getRelays(pubkey));

      let ev = await pool.get([config.nostr], {
        kinds: [3],
        authors: [pubkey],
      });
      if (!ev) {
        pool
          .get(relays, {
            kinds: [3],
            authors: [pubkey],
          })
          .then(send);
      }

      let created_at;
      let follows = [];
      let tags = [];
      if (ev) ({ created_at, tags } = ev);
      if (!tags.length || tagsonly) return res.send(tags);

      let cache = await g(`${pubkey}:follows`);
      if (cache && cache.t >= created_at) ({ follows } = cache);
      else {
        let profiles = [];
        let pubkeys = tags.map((t) => t[1]).filter((p) => p.length === 64);
        for (let authors of chunk(pubkeys, 100)) {
          let filter = { authors, kinds: [0] };
          profiles.push(...(await pool.querySync([config.nostr], filter)));
        }

        for (let p of profiles) {
          let { content, pubkey } = p;
          let user = JSON.parse(content);

          let cache = await g(`${pubkey}:followers`);
          let followers;
          if (cache && cache.t >= created_at) ({ followers } = cache);
          else {
            let filter = { "#p": [pubkey], kinds: [3] };
            followers = await pool.querySync([config.nostr], filter);
            s(`${pubkey}:followers`, { followers, t: created_at });
          }

          user.followers = followers.length;
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
