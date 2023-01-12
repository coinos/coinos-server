import { createClient } from "redis";

const redis = createClient({
  url: "redis://rd"
});

redis.on("error", err => console.log("redis error", err));

await redis.connect();

export default redis;

export let g = async k => JSON.parse(await redis.get(k));
export let s = (k, v) => redis.set(k, JSON.stringify(v));
export let rd = redis;
