import config from "$config";
import {
  CashuMint,
  CashuWallet,
  getDecodedToken,
  getEncodedToken,
  getEncodedTokenV4,
} from "@cashu/cashu-ts";
import { g, s } from "$lib/db";
import { fail } from "$lib/utils";

let m = new CashuMint(config.mintUrl);
let w = new CashuWallet(m);

let enc = (proofs, v = 4) =>
  (v === 4 ? getEncodedTokenV4 : getEncodedToken)({
    token: [{ mint: config.mintUrl, proofs }],
  });

let dec = (token) => getDecodedToken(token).token[0];

let ext = async (mint) => {
  let issuer = new CashuMint(mint);
  let { pubkey: issuerPk } = await issuer.getInfo();
  let { pubkey: ourPk } = await m.getInfo();
  return issuerPk !== ourPk;
};

export async function get(id, v = 4) {
  let token = await g(`cash:${id}`);
  if (v < 4) return enc(dec(token).proofs, 3);
  return token;
}

export async function claim(token) {
  let { proofs: current } = dec(await g(`cash`));
  let { mint } = dec(token);

  if (await ext(mint)) fail("Unable to receive from other mints");

  let rcvd = await w.receive(token);

  await s(`cash`, enc([...current, ...rcvd]));
  return rcvd.reduce((a, b) => a + b.amount, 0);
}

export async function mint(amount, v = 4) {
  let { proofs } = dec(await g(`cash`));
  let { send, returnChange } = await w.send(amount, proofs);
  let rcvd = await w.receive(enc(send, v));
  let change = enc(returnChange, v);
  await s(`cash`, change);
  return enc(rcvd, v);
}

export async function check(token) {
  let o = dec(token);
  let { mint, proofs } = o;
  let total = proofs.reduce((a, b) => a + b.amount, 0);

  let external = await ext(mint);

  let r = await w.checkProofsSpent(proofs);
  let spent = r.reduce((a, b) => a + b.amount, 0);

  return { total, spent, mint, external };
}
