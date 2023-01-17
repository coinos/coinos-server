import { createClient } from "redis";

export const db = createClient({ url: "redis://db" });

db.on("error", err => console.log("db error", err));

await db.connect();

export default db;

export let g = async k => JSON.parse(await db.get(k));
export let s = (k, v) => db.set(k, JSON.stringify(v));

let retries = {};
export let t = async (k, f) => {
  retries[k] = retries[k] ? retries[k]++ : 0;
  await db.watch(k);
  let o = f(await g(k));
  let m = await db.multi();
  await s(k, o);

  if (retries[k] < 10) {
    if (!(await m.exec())) setTimeout(() => t(k, f), 100);
  } else throw new Error("could not obtain lock");
};
