import store from "$lib/store";
import { g } from "$lib/db";
import config from "$config";

export const nada = () => {};

export const sleep = n => new Promise(r => setTimeout(r, n));
export const wait = async (f, s = 300, n = 50) => {
  let i = 0;
  while (!(await f()) && i < s) (await sleep(n)) && i++;
  if (i >= s) throw new Error("timeout");
  return f();
};

export const prod = process.env.NODE_ENV === "production";
export const fail = msg => {
  throw new Error(msg);
};

export const bail = (res, msg) => res.code(500).send(msg);

export const SATS = 100000000;
export const sats = n => Math.round(n * SATS);
export const btc = n => parseFloat((n / SATS).toFixed(8));

export const uniq = (a, k) => [...new Map(a.map(x => [k(x), x])).values()];
export const pick = (O, K) =>
  K.reduce((o, k) => (typeof O[k] !== "undefined" && (o[k] = O[k]), o), {});

export const bip21 = (address, { amount, memo, tip }) => {
  let url = amount || memo ? `bitcoin:${address}?` : address;
  if (amount)
    url += `amount=${((amount + tip) / SATS).toFixed(8)}${memo ? "&" : ""}`;
  if (memo) url += `message=${memo}`;

  return url;
};

export const fields = [
  "cipher",
  "pubkey",
  "password",
  "username",
  "salt",
  "currency",
  "currencies",
  "fiat",
  "otpsecret",
  "balance",
  "ip",
  "pin",
  "display",
  "haspin",
  "profile",
  "prompt",
  "banner"
];

export const getUser = async username => {
  username = username.replace(/\s/g, "").toLowerCase();
  let uid = await g(`user:${username}`);
  return g(`user:${uid}`);
};
