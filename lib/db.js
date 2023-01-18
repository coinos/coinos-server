import { Redis } from "ioredis";
import Redlock from "redlock";

export const db = new Redis("redis://db", { enableAutoPipelining: true });
export default db;

export let g = async k => JSON.parse(await db.get(k));
export let s = (k, v) => db.set(k, JSON.stringify(v));
export let t = (f) => new Redlock([db]).using([db], 5000, f);
