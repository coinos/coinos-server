import { g, s } from "$lib/db";
import { l } from "$lib/logging";
import { fail } from "$lib/utils";
import { v4 } from "uuid";
import got from "got";
import { invoice } from "$lib/invoices";
import { bech32 } from "bech32";

export default {
  async encode({ query: { address } }, res) {
    let [name, domain] = address.split("@");
    let url = `https://${domain}/.well-known/lnurlp/${name}`;
    let r = await got(url).json();
    if (r.tag !== "payRequest") fail("not an ln address");
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
    let uid = await g(`user:${username}`);
    if (!uid) fail("user not found");

    let id = v4();
    await s(`lnurl:${id}`, uid);
    let { URL } = process.env;
    let host = URL.split("/").at(-1);

    res.send({
      metadata: [
        ["text/plain", `Paying ${username}@${host}`],
        ["text/identifier", `${username}@${host}`]
      ],
      callback: `${URL}/lnurl/${id}`,
      tag: "payRequest"
    });
  },

  async lnurl({ params: { id }, query: { amount } }, res) {
    let pr = await g(`lnurlp:${id}`);

    if (!pr) {
      let uid = await g(`lnurl:${id}`);
      let user = await g(`user:${uid}`);

      ({ text: pr } = await invoice({
        invoice: {
          amount,
          type: types.lightning
        },
        user
      }));

      await s(`lnurlp:${id}`, pr);
    }

    res.send({ pr });
  }
};
