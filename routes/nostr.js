import { nada, uniq } from "$lib/utils";
import config from "$config";
import { g, s, db } from "$lib/db";
import { pool, q } from "$lib/nostr";

export default {
  async event({ params: { id } }, res) {
    let event = await g(`ev:${id}`);
    let { pubkey } = event;

    event.user = (await g(`user:${pubkey}`)) || {
      username: pubkey.substr(0, 6),
      pubkey,
      anon: true,
      follows: [],
      followers: []
    };

    res.send(event);
  },

  async notes({ params: { pubkey } }, res) {
    let user = await g(`user:${pubkey}`);

    if (!user)
      user = {
        username: pubkey.substr(0, 6),
        pubkey,
        anon: true,
        follows: [],
        followers: []
      };

    let params = {
        kinds: [1],
        authors: [pubkey]
      },
      opts = { since: 0 };

    q(`${pubkey}:notes`, params, opts).catch(nada);

    await s(`user:${pubkey}`, user);

    let ids = await db.sMembers(pubkey);

    let events = ids.length
      ? (await db.mGet(ids.map(k => "ev:" + k))).map(JSON.parse)
      : [];

    res.send(events.map(e => ({ ...e, user })));
  },

  async broadcast(req, res) {
    let { event } = req.body;
    console.log("sending", event)
    pool.send(["EVENT", event]);
    res.send(event);
  },

  async follows({ params: { pubkey }, query: { tagsonly } }, res) {
    let sub = `${pubkey}:follows`,
      params = {
        limit: 1,
        kinds: [3],
        authors: [pubkey]
      },
      opts = { timeout: 60000, eager: 60000 };

    q(sub, params, opts).catch(nada);

    let tags = (await g(`${pubkey}:follows`)) || [];
    if (tagsonly) return res.send(tags);

    let follows = [];
    for (let f of tags) {
      let [_, pubkey] = f;

      q(`${pubkey}:profile:f1`, {
        limit: 1,
        kinds: [0],
        authors: [pubkey]
      }).catch(nada);

      let user = await g(`user:${pubkey}`);

      if (!user)
        user = {
          username: pubkey.substr(0, 6),
          pubkey,
          anon: true
        };

      follows.push(user);
    }

    follows = uniq(follows, e => e.pubkey);
    follows.sort((a, b) => a.username.localeCompare(b.username));

    res.send(follows);
  },

  async followers({ params: { pubkey } }, res) {
    try {
      let pubkeys = [
        ...new Set([...(await db.sMembers(`${pubkey}:followers`))])
      ];

      let followers = [];

      q(
        `${pubkey}:followers`,
        { kinds: [3], "#p": [pubkey] },
        { timeout: 60000, eager: 60000 }
      ).catch(nada);

      for (let pubkey of pubkeys) {
        let user = await g(`user:${pubkey}`);
        if (!user || !user.updated) {
          q(`${pubkey}:profile:f2`, {
            limit: 1,
            kinds: [0],
            authors: [pubkey]
          }).catch(nada);

          user = await g(`user:${pubkey}`);
        }

        if (!user)
          user = {
            username: pubkey.substr(0, 6),
            pubkey,
            anon: true
          };

        followers.push(user);
      }

      followers = uniq(followers, e => e.pubkey);
      followers.sort((a, b) => a.username.localeCompare(b.username));

      res.send(followers);
    } catch (e) {
      console.log(e);
      res.code(500).send(e && e.message);
    }
  },

  async identities(req, res) {
    res.send({
      names: {
        adam:
          "566c166f3adab0c8fba5da015b0b3bcc8eb3696b455f2a1d43bfbd97059646a8",
        asoltys:
          "566c166f3adab0c8fba5da015b0b3bcc8eb3696b455f2a1d43bfbd97059646a8"
      }
    });
  }
};
