import config from "$config";
import {
  CashuMint,
  CashuWallet,
  getDecodedToken,
  getEncodedToken,
  MintQuoteState,
} from "@cashu/cashu-ts";
import { g, s } from "$lib/db";
import ln from "$lib/ln";
import { fail } from "$lib/utils";

let m = new CashuMint(config.mintUrl);
let w = new CashuWallet(m);

let enc = (proofs) =>
  getEncodedToken({
    token: [{ mint: config.mintUrl, proofs }],
  });

let dec = (token) => getDecodedToken(token).token[0];

let ext = async (mint) => {
  let issuer = new CashuMint(mint);
  let { pubkey: issuerPk } = await issuer.getInfo();
  let { pubkey: ourPk } = await m.getInfo();
  console.log(issuerPk, ourPk);
  return issuerPk !== ourPk;
};

export async function claim(token) {
  let { proofs: current } = dec(await g(`cash`));
  let { mint } = dec(token);

  if (await ext(mint)) fail("Unable to receive from other mints");

  let rcvd = await w.receive(token);

  await s(`cash`, enc([...current, ...rcvd]));
  return rcvd.reduce((a, b) => a + b.amount, 0);
}

export async function mint(amount) {
  let { proofs } = dec(await g(`cash`));
  let { send, returnChange } = await w.send(amount, proofs);
  let rcvd = await w.receive(enc(send));
  await s(`cash`, enc(returnChange));
  return enc(rcvd);
}

export async function check(token) {
  let { mint, proofs } = dec(token);
  let total = proofs.reduce((a, b) => a + b.amount, 0);

  let external = await ext(mint);

  let r = await w.checkProofsSpent(proofs);
  let spent = r.reduce((a, b) => a + b.amount, 0);

  return { total, spent, mint, external };
}
