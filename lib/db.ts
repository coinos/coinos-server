import config from "$config";
import { err, warn } from "$lib/logging";
import { fail, sleep } from "$lib/utils";
import { createClient } from "redis";

export const db = createClient({
  url: config.db,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 5000),
  },
});

export const archive = createClient({
  url: config.archive,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 5000),
  },
});

export const arc2 = createClient({
  url: config.arc2,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 5000),
  },
});

async function dbReconnect() {
  try {
    await db.connect();
  } catch (err) {
    console.error("Failed to connect to Redis, retrying...", err);
    setTimeout(dbReconnect, 5000); // Retry after 5 seconds
  }
}

async function archiveReconnect() {
  try {
    await archive.connect();
  } catch (err) {
    console.error("Failed to connect to Redis, retrying...", err);
    setTimeout(archiveReconnect, 5000); // Retry after 5 seconds
  }
}

dbReconnect();
archiveReconnect();

db.on("error", (e) => {
  if (e.message.startsWith("getaddr")) return;
  err("Redis error", e.message);
});

db.on("end", () => {
  warn("Redis connection ended");
});

export default db;

export const g = async (k) => {
  const v = await db.get(k);
  try {
    return JSON.parse(v);
  } catch (e) {
    return v;
  }
};

export const s = (k, v) => {
  if (k === "user:null" || k === "user:undefined") fail("null user");
  return db.set(k, JSON.stringify(v));
};

export async function* scan(pattern: string) {
  for await (const keys of db.scanIterator({ MATCH: pattern })) {
    for (const k of keys) yield k;
  }
}

export const ga = async (k) => {
  const v = await archive.get(k);
  try {
    return JSON.parse(v);
  } catch (e) {
    return v;
  }
};

export const sa = (k, v) => {
  if (k === "user:null" || k === "user:undefined") {
    warn("###### NULL USER #######");
    console.trace();
  }
  archive.set(k, JSON.stringify(v));
};

// Get with fallback to archive
export const gf = async (k) => {
  let v = await db.get(k);
  if (v === null) v = await archive.get(k);
  try {
    return JSON.parse(v);
  } catch (e) {
    return v;
  }
};

// lRange with fallback to archive for missing items
export const lRangeWithArchive = async (k, start, end) => {
  const items = await db.lRange(k, start, end);
  return items || [];
};

// Get payment/invoice with archive fallback - for individual lookups
export const getWithArchive = async (prefix, id) => {
  let v = await db.get(`${prefix}:${id}`);
  if (v === null) v = await archive.get(`${prefix}:${id}`);
  if (v === null) return null;
  try {
    const parsed = JSON.parse(v);
    // If it's a reference to another key, follow it
    if (typeof parsed === "string") {
      let ref = await db.get(`${prefix}:${parsed}`);
      if (ref === null) ref = await archive.get(`${prefix}:${parsed}`);
      if (ref === null) return null;
      return JSON.parse(ref);
    }
    return parsed;
  } catch (e) {
    return v;
  }
};

const retries = {};
export const t = async (k, f) => {
  try {
    await db.watch(k);
    await f(await db.get(k), db);
  } catch (err) {
    if (!err.message.includes("watch")) throw err;

    const r = retries[k] || 0;
    retries[k] = r + 1;

    if (r < 10) {
      await sleep(100);
      await t(k, f);
    } else {
      delete retries[k];
      fail("unable to obtain lock");
    }
  }

  delete retries[k];
};
