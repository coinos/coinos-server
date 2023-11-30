import { g, s } from "$lib/db";
import { l, warn } from "$lib/logging";
import { bail, getUser, fail } from "$lib/utils";
import { v4 } from "uuid";
import got from "got";
import { generate } from "$lib/invoices";
import { bech32 } from "bech32";
import { fields, pick } from "$lib/utils";
import { types } from "$lib/payments";
import crypto from "crypto";

import config from "$config";
let { admin, classic } = config;

let { URL } = process.env;
let host = URL.split("/").at(-1);

export default {
  async encode({ query: { address } }, res) {
    let [name, domain] = address.split("@");
    let url = `https://${domain}/.well-known/lnurlp/${name}`;

    try {
      let r = await got(url).json();
      if (r.tag !== "payRequest") fail("not an ln address");
    } catch (e) {
      let m = `failed to lookup lightning address ${address}`;
      warn(m);
      return bail(res, m);
    }

    let enc = bech32.encode("lnurl", bech32.toWords(Buffer.from(url)), 20000);
    res.send(enc);
  },

  async decode({ query: { text } }, res) {
    try {
      let url = Buffer.from(
        bech32.fromWords(bech32.decode(text, 20000).words)
      ).toString();

      res.send(await got(url).json());
    } catch (e) {
      bail(res, e.message);
    }
  },

  async lnurlp({ params: { username } }, res) {
    try {
      let { id: uid, pubkey: nostrPubkey } = await getUser(username);

      let metadata = JSON.stringify([
        ["text/plain", `Paying ${username}@${host}`],
        ["text/identifier", `${username}@${host}`]
      ]);

      let id = v4();
      await s(`lnurl:${id}`, uid);

      res.send({
        allowsNostr: true,
        minSendable: 1000,
        maxSendable: 100000000000,
        metadata,
        nostrPubkey,
        callback: `${URL}/api/lnurl/${id}`,
        tag: "payRequest"
      });
    } catch (e) {
      warn("problem generating lnurlp request", e.message);
      bail(res, e.message);
    }
  },

  async lnurlw({ params: { k1, pr } }, res) {},

  async lnurl({ params: { id }, query: { amount, nostr } }, res) {
    let uid = await g(`lnurl:${id}`);
    let user = await g(`user:${uid}`);
    let { username } = user;
    username = username.replace(/\s/g, "").toLowerCase();

    if (nostr) {
      try {
        let event = JSON.parse(decodeURIComponent(nostr));
        // TODO: validate the event
        await s(`zap:${id}`, event);
      } catch (e) {
        err("problem handling zap", e.message);
      }
    }

    let metadata = JSON.stringify([
      ["text/plain", `Paying ${username}@${host}`],
      ["text/identifier", `${username}@${host}`]
    ]);

    let { text: pr } = await generate({
      invoice: {
        amount: Math.round(amount / 1000),
        type: types.lightning
      },
      memo: metadata,
      user
    });

    res.send({ pr, routes: [] });
  }
};
