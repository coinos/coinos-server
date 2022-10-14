import { createClient } from "redis";

const redis = createClient({
  url: "redis://redis",
});

redis.on("error", (err) => console.log("redis error", err));

await redis.connect();

export default redis;
