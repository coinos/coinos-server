import { bail, nada, uniq } from "$lib/utils";
import config from "$config";
import { g, s, db } from "$lib/db";
import { pool, q } from "$lib/nostr";

export default {
  async event({ params: { id } }, res) {
    let event = await g(`ev:${id}`);
    if (!event) return bail(res, "event not found");

    let { pubkey } = event;

    event.user = (await g(`user:${pubkey}`)) || {
      username: pubkey.substr(0, 6),
      pubkey,
      anon: true,
      follows: [],
      followers: [],
    };

    res.send(event);
  },

  async notes({ params: { pubkey } }, res) {
    let uid = await g(`user:${pubkey}`);
    let user = await g(`user:${uid}`);

    if (!user)
      user = {
        username: pubkey.substr(0, 6),
        pubkey,
        anon: true,
        follows: [],
        followers: [],
      };

    let params = {
        kinds: [1],
        authors: [pubkey],
      },
      opts = { since: 0 };

    q(`${pubkey}:notes`, params, opts).catch(nada);

    let ids = await db.sMembers(pubkey);

    let events = ids.length
      ? (await db.mGet(ids.map((k) => "ev:" + k))).map(JSON.parse)
      : [];

    res.send(events.map((e) => ({ ...e, user })));
  },

  async messages({ params: { pubkey, since = 0 } }, res) {
    let params = {
      kinds: [4],
      authors: [pubkey],
    };

    let opts = { since };

    await q(`${pubkey}:messages`, params, opts).catch(nada);

    params = {
      kinds: [4],
      "#p": [pubkey],
    };

    await q(`${pubkey}:messages`, params, opts).catch(nada);

    let messages = await db.sMembers(`${pubkey}:messages`);
    messages = await Promise.all(
      messages.map(async (id) => {
        let m = await g(`ev:${id}`);

        let aid = await g(`user:${m.pubkey}`);
        m.author = await g(`user:${aid}`);

        let rid = await g(`user:${m.tags[0][1]}`);
        m.recipient = await g(`user:${rid}`);

        return m;
      })
    );

    res.send(messages);
  },

  async broadcast(req, res) {
    let { event } = req.body;
    pool.send(["EVENT", event]);
    res.send(event);
  },

  async follows({ params: { pubkey }, query: { tagsonly } }, res) {
    let sub = `${pubkey}:follows`,
      params = {
        limit: 1,
        kinds: [3],
        authors: [pubkey],
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
        authors: [pubkey],
      }).catch(nada);

      let uid = await g(`user:${pubkey}`);
      let user = await g(`user:${uid}`);

      if (!user)
        user = {
          username: pubkey.substr(0, 6),
          pubkey,
          anon: true,
        };

      follows.push(user);
    }

    follows = uniq(follows, (e) => e.pubkey);
    follows.sort((a, b) => a.username.localeCompare(b.username));

    res.send(follows);
  },

  async followers({ params: { pubkey } }, res) {
    try {
      let pubkeys = [
        ...new Set([...(await db.sMembers(`${pubkey}:followers`))]),
      ];

      let followers = [];

      q(
        `${pubkey}:followers`,
        { kinds: [3], "#p": [pubkey] },
        { timeout: 60000, eager: 60000 }
      ).catch(nada);

      for (let pubkey of pubkeys) {
        let uid = await g(`user:${pubkey}`);
        let user = await g(`user:${uid}`);
        if (!user || !user.updated) {
          await q(`${pubkey}:profile:f2`, {
            limit: 1,
            kinds: [0],
            authors: [pubkey],
          }).catch(nada);

          uid = await g(`user:${pubkey}`);
          user = await g(`user:${uid}`);
        }

        if (!user)
          user = {
            username: pubkey.substr(0, 6),
            pubkey,
            anon: true,
          };

        followers.push(user);
      }

      followers = uniq(followers, (e) => e.pubkey);
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
        adam: "566c166f3adab0c8fba5da015b0b3bcc8eb3696b455f2a1d43bfbd97059646a8",
        asoltys:
          "566c166f3adab0c8fba5da015b0b3bcc8eb3696b455f2a1d43bfbd97059646a8",
      },
    });
  },
};
