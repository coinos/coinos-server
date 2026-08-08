import config from "$config";
import { g, s } from "$lib/db";
import { lnb } from "$lib/ln";
import { fail, wait } from "$lib/utils";
import {
  CashuMint,
  CashuWallet,
  MintQuoteState,
  PaymentRequest,
  PaymentRequestTransportType,
  getDecodedToken,
  getEncodedToken,
  getEncodedTokenV4,
} from "@cashu/cashu-ts";


const { URL } = process.env;
const m = new CashuMint(config.mintUrl);
const w = new CashuWallet(m);

const enc = (proofs) =>
  getEncodedToken({
    mint: config.mintUrl,
    proofs,
  });

// Serialize every read-modify-write of the shared `cash` house-wallet token. The
// mint swap sits between reading the current proofs and writing the merged set,
// so two concurrent claim()/mint() calls would each read the same `current` and
// the later write would clobber the earlier — the earlier call's freshly-swapped
// proofs vanish from the stored token while both users stay credited (an
// insolvency leak). This mutex is in-process; if the server ever runs
// multi-process, move to a redis lock (WATCH/MULTI or SET NX).
let cashLock: Promise<void> = Promise.resolve();
const withCashLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  const prev = cashLock;
  let release: () => void = () => {};
  cashLock = new Promise((res) => {
    release = res;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
};

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
  const { mint } = getDecodedToken(token);

  if (await ext(mint)) fail("Unable to receive from other mints");

  return withCashLock(async () => {
    const { proofs: current } = getDecodedToken(await g("cash"));
    const rcvd = await w.receive(token);
    await s("cash", enc([...current, ...rcvd]));
    return rcvd.reduce((a, b) => a + b.amount, 0);
  });
}

export async function mint(amount) {
  const { keysets } = await m.getKeySets();
  const w = new CashuWallet(m, { keysets });
  return withCashLock(async () => {
    const { proofs } = getDecodedToken(await g("cash"));
    const { send, keep } = await w.send(amount, proofs);
    const rcvd = await w.receive(enc(send));
    const change = enc(keep);
    await s("cash", change);
    return enc(rcvd);
  });
}

export async function check(token) {
  const { mint, proofs } = getDecodedToken(token);
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
  } catch (e) {}
}

export function request(uuid, amount, memo) {
  const target = `${URL}/api/ecash/${uuid}`;

  const { POST: type } = PaymentRequestTransportType;
  const transport = [{ type, target }];
  const unit = "sat";

  return new PaymentRequest(
    transport,
    uuid,
    amount,
    unit,
    [config.mintUrl],
    memo,
  ).toEncodedRequest();
}
