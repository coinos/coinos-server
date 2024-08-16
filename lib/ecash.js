import config from "$config";
import {
  CashuMint,
  CashuWallet,
  getDecodedToken,
  getEncodedToken,
} from "@cashu/cashu-ts";
import { g, s } from "$lib/db";

let wallet = new CashuWallet(new CashuMint(config.mintUrl));

let enc = (proofs) =>
  getEncodedToken({
    token: [{ mint: config.mintUrl, proofs }],
  });

let dec = (token) => getDecodedToken(token).token[0];

export async function melt(user, amount) {
  let { proofs } = dec(await g(`cash:${user.id}`));
  let { proofs: current } = dec(await g(`cash`));

  let { send, returnChange } = await wallet.send(amount, proofs);

  await s(`cash`, enc([...current, ...send]));
  await s(`cash:${user.id}`, enc(returnChange));
}

export async function mint(user, amount) {
  let { proofs } = dec(await g(`cash`));
  let { proofs: current } = dec(await g(`cash:${user.id}`));

  let { send, returnChange } = await wallet.send(amount, proofs);

  await s(`cash:${user.id}`, enc([...current, ...send]));
  await s(`cash`, enc(returnChange));
}

export async function balance(user) {
  let { proofs } = dec(await g(`cash:${user.id}`));
  return proofs.reduce((a, b) => a + b.amount, 0);
}
