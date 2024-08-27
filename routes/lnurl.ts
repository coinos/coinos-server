import { g, s } from "$lib/db";
import { err, warn } from "$lib/logging";
import { bail, getUser, fail } from "$lib/utils";
import { v4 } from "uuid";
import got from "got";
import { generate } from "$lib/invoices";
import { bech32 } from "bech32";
import { types } from "$lib/payments";
import { COINOS_PUBKEY } from "$lib/nostr";

let { URL } = process.env;
let host = URL.split("/").at(-1);

export default {
  async encode(req, res) {
    let {
      query: { address },
    } = req;
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

  async decode(req, res) {
    let {
      query: { text },
    } = req;
    try {
      let url = Buffer.from(
        bech32.fromWords(bech32.decode(text, 20000).words),
      ).toString();

      res.send(await got(url).json());
    } catch (e) {
      bail(res, e.message);
    }
  },

  async lnurlp(req, res) {
    let {
      params: { username },
      query: { minSendable = 1000, maxSendable = 100000000000 },
    } = req;
    try {
      let { id: uid } = await getUser(username);

      let metadata = JSON.stringify([
        ["text/plain", `Paying ${username}@${host}`],
        ["text/identifier", `${username}@${host}`],
      ]);

      let id = v4();
      await s(`lnurl:${id}`, uid);

      res.send({
        allowsNostr: true,
        minSendable,
        maxSendable,
        metadata,
        nostrPubkey: COINOS_PUBKEY,
        callback: `${URL}/api/lnurl/${id}`,
        tag: "payRequest",
      });
    } catch (e) {
      warn("problem generating lnurlp request", username, e.message);
      bail(res, e.message);
    }
  },

  async lnurl(req, res) {
    let {
      params: { id },
      query: { amount, nostr },
    } = req;
    try {
      let uid = await g(`lnurl:${id}`);
      let user = await getUser(uid);
      if (!user) fail("user not found");
      let { username } = user;
      username = username.replace(/\s/g, "").toLowerCase();

      let memo = `Paying ${username}@${host}`;
      let metadata = JSON.stringify([
        ["text/plain", memo],
        ["text/identifier", `${username}@${host}`],
      ]);

      if (nostr) {
        try {
          let event = JSON.parse(decodeURIComponent(nostr));
          // TODO: validate the event
          await s(`zap:${id}`, event);
          metadata = nostr;
        } catch (e) {
          err("problem handling zap", e.message);
        }
      }

      let { id: iid, text: pr } = await generate({
        invoice: {
          amount: Math.round(amount / 1000),
          memo: metadata,
          type: types.lightning,
        },
        user,
      });

      res.send({ pr, routes: [], verify: `${URL}/api/lnurl/verify/${iid}` });
    } catch (e) {
      bail(res, e.message);
    }
  },

  async verify(req, res) {
    let {
      params: { id },
    } = req;
    let inv = await g(`invoice:${id}`);

    if (!inv) return res.send({ status: "ERROR", reason: "Not found" });

    let { received, amount, preimage } = inv;
    let settled = received >= amount;

    res.send({ status: "OK", settled, preimage });
  },
};
