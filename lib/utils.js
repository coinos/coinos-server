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

export const requirePin = async ({ body, user }) => {
  if (!user || (user.pin && user.pin !== body.pin))
    throw new Error("Invalid pin");
};

export const prod = process.env.NODE_ENV === "production";
export const fail = msg => {
  throw new Error(msg);
};

export const SATS = 100000000;
export const toSats = n => Math.round(n * SATS);

export const uniq = (a, k) => [...new Map(a.map(x => [k(x), x])).values()];
export const pick = (O, K) =>
  K.reduce((o, k) => (typeof O[k] !== "undefined" && (o[k] = O[k]), o), {});
