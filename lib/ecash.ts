import config from "$config";
import { g, s } from "$lib/db";
import { lnb } from "$lib/ln";
import { fail, wait } from "$lib/utils";
import {
  CashuMint,
  CashuWallet,
  MintQuoteState,
  getDecodedToken,
  getEncodedToken,
  getEncodedTokenV4,
} from "@cashu/cashu-ts";

const m = new CashuMint(config.mintUrl);
const w = new CashuWallet(m);

const enc = (proofs) =>
  getEncodedToken({
    mint: config.mintUrl,
    proofs,
  });

const ext = async (mint) => {
  const issuer = new CashuMint(mint);
  const { pubkey: issuerPk } = await issuer.getInfo();
  const { pubkey: ourPk } = await m.getInfo();
  return issuerPk !== ourPk;
};

export async function get(id) {
  const token = await g(`cash:${id}`);
  return token;
}

export async function claim(token) {
  const { proofs: current } = getDecodedToken(await g("cash"));
  const { mint } = getDecodedToken(token);

  if (await ext(mint)) fail("Unable to receive from other mints");

  const rcvd = await w.receive(token);

  await s("cash", enc([...current, ...rcvd]));
  return rcvd.reduce((a, b) => a + b.amount, 0);
}

export async function mint(amount) {
  const { keysets } = await m.getKeySets();
  const w = new CashuWallet(m, { keysets });
  const { proofs } = getDecodedToken(await g("cash"));
  const { send, keep } = await w.send(amount, proofs);
  const rcvd = await w.receive(enc(send));
  const change = enc(keep);
  await s("cash", change);
  return enc(rcvd);
}

export async function check(token) {
  const o = getDecodedToken(token);
  const { mint, proofs } = o;
  const total = proofs.reduce((a, b) => a + b.amount, 0);

  const external = await ext(mint);

  let spent = 0;
  for (const [i, p] of (await w.checkProofsStates(proofs)).entries()) {
    if (p.state === "SPENT") spent += proofs[i].amount;
  }

  return { total, spent, mint, external };
}

export async function init(amount = 100000) {
  try {
    await new Promise((r) => setTimeout(r, 2000));
    const { quote, request } = await w.createMintQuote(amount);
    await lnb.pay(request);

    await wait(async () => {
      const { state } = await w.checkMintQuote(quote);
      return state === MintQuoteState.PAID;
    });

    const proofs = await w.mintProofs(amount, quote);

    const cash = getEncodedTokenV4({
      mint: config.mintUrl,
      proofs,
    });

    await s("cash", cash);
  } catch (e) {
    console.log(e);
  }
}
