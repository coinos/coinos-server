import { createClient } from "redis";

export const db = createClient({
  url: "redis://rd"
});

db.on("error", err => console.log("db error", err));

await db.connect();

export default db;

export let g = async k => JSON.parse(await db.get(k));
export let s = (k, v) => db.set(k, JSON.stringify(v));
