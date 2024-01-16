import migrate from "$lib/migrate";
import store from "$lib/store";
import { g } from "$lib/db";
import config from "$config";

export let fail = (msg) => {
  throw new Error(msg);
};

export let nada = () => {};

export let sleep = (n) => new Promise((r) => setTimeout(r, n));
export let wait = async (f, s = 300, n = 50) => {
  let i = 0;
  while (!(await f()) && i < s) (await sleep(n)) && i++;
  if (i >= s) fail("timeout");
  return f();
};

export let prod = process.env.NODE_ENV === "production";

export let bail = (res, msg) => res.code(500).send(msg);

export let SATS = 100000000;
export let sats = (n) => Math.round(n * SATS);
export let btc = (n) => parseFloat((n / SATS).toFixed(8));

export let uniq = (a, k) => [...new Map(a.map((x) => [k(x), x])).values()];
export let pick = (O, K) =>
  K.reduce((o, k) => (typeof O[k] !== "undefined" && (o[k] = O[k]), o), {});

export let bip21 = (address, { amount, memo, tip, type }) => {
  if (!(amount || memo)) return address;

  let network = { liquid: "liquidnetwork", bitcoin: "bitcoin" }[type];
  let url = new URLSearchParams();

  if (amount) {
    url.append("amount", btc(amount));
    if (type === "liquid") url.append("assetid", config.liquid.btc);
  }

  if (memo) url.append("memo", memo);

  return `${network}:${address}?${url.toString()}`;
};

export let fields = [
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
  "banner",
];

export let getUser = async (username) => {
  let user = await migrate(username);
  if (!user || username === "undefined") fail(`user ${username} not found`);
  return user;
};
