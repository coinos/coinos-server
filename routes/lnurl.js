import { g, s } from "$lib/db";
import { l, warn } from "$lib/logging";
import { bail, fail } from "$lib/utils";
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
    let url = Buffer.from(
      bech32.fromWords(bech32.decode(text, 20000).words)
    ).toString();

    res.send(await got(url).json());
  },

  async lnurlp({ params: { username } }, res) {
    let uid = await g(`user:${username.toLowerCase()}`);
    if (!uid) {
      let u = await got(`${classic}/admin/migrate/${username}?zero=true`, {
        headers: { authorization: `Bearer ${admin}` }
      }).json();

      if (!u) fail("user not found");
      let { balance, pubkey } = u;

      uid = u.uuid;

      u = { id: uid, about: u.address, ...pick(u, fields) };
      delete u.address;

      await s(`user:${username.toLowerCase()}`, uid);
      await s(`user:${uid}`, u);
      await s(`balance:${uid}`, balance);

      l("added missing user", username);
    }

    let metadata = JSON.stringify([
      ["text/plain", `Paying ${username}@${host}`],
      ["text/identifier", `${username}@${host}`]
    ]);

    let id = v4();
    await s(`lnurl:${id}`, uid);

    res.send({
      minSendable: 1000,
      maxSendable: 100000000000,
      metadata,
      callback: `${URL}/api/lnurl/${id}`,
      tag: "payRequest"
    });
  },

  async lnurl({ params: { id }, query: { amount } }, res) {
    let pr = await g(`lnurlp:${id}`);

    if (!pr) {
      let uid = await g(`lnurl:${id}`);
      let user = await g(`user:${uid}`);
      let { username } = user;

      let metadata = JSON.stringify([
        ["text/plain", `Paying ${username}@${host}`],
        ["text/identifier", `${username}@${host}`]
      ]);

      ({ text: pr } = await generate({
        invoice: {
          amount: Math.round(amount / 1000),
          type: types.lightning
        },
        memo: metadata,
        user
      }));

      await s(`lnurlp:${id}`, pr);
    }

    res.send({ pr, routes: [] });
  }
};
