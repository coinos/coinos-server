import store from "$lib/store";
import { g } from "$lib/redis";
import config from "$config";
import ln from "$lib/ln";

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

export const getUser = async (uuid) => {
  let user = g(`user:${uuid}`);
  if (!user) throw new Error("user not found");

  user.haspin = !!user.pin;

  return user;
};

export const prod = process.env.NODE_ENV === "production";
export const fail = msg => {
  throw new Error(msg);
};

export const SATS = 100000000;
export const toSats = n => Math.round(n * SATS);

export const derivePayRequest = async ({ amount, memo, tip }) => {
  if (!tip) tip = 0;
  let value = amount + tip;

  if (!memo) memo = "coinos";
  return (
    await ln.invoice(value ? `${value}sat` : "any", new Date(), memo, 360)
  ).bolt11;
};

export const uniq = (a, k) => [...new Map(a.map(x => [k(x), x])).values()];
