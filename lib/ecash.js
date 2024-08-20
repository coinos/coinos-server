import config from "$config";
import {
  CashuMint,
  CashuWallet,
  getDecodedToken,
  getEncodedToken,
  MintQuoteState,
} from "@cashu/cashu-ts";
import { g, s } from "$lib/db";

let wallet = new CashuWallet(new CashuMint(config.mintUrl));

let enc = (proofs) =>
  getEncodedToken({
    token: [{ mint: config.mintUrl, proofs }],
  });

let dec = (token) => getDecodedToken(token).token[0];

export async function claim(token) {
  let { proofs: current } = dec(await g(`cash`));
  let rcvd = await wallet.receive(token);

  await s(`cash`, enc([...current, ...rcvd]));
  return rcvd.reduce((a, b) => a + b.amount, 0);
}

export async function mint(amount) {
  let { proofs } = dec(await g(`cash`));
  let { send, returnChange } = await wallet.send(amount, proofs);
  let rcvd = await wallet.receive(enc(send));
  await s(`cash`, enc(returnChange));
  return enc(rcvd);
}

export async function check(token) {
  let { proofs } = dec(token);
  let total = proofs.reduce((a, b) => a + b.amount, 0);

  let r = await wallet.checkProofsSpent(proofs);
  let spent = r.reduce((a, b) => a + b.amount, 0);

  return { total, spent };
}
