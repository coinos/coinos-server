import config from "$config";
import { fail, sleep } from "$lib/utils";
import { createClient, defineScript } from "redis";
import { warn, err } from "$lib/logging";

const DEBIT = `
local balanceKey = KEYS[1]
local creditKey = KEYS[2]
local insufficientString = KEYS[3];
local amount = tonumber(ARGV[1])
local tip = tonumber(ARGV[2])
local fee = tonumber(ARGV[3])
local ourfee = tonumber(ARGV[4])
local frozen = tonumber(ARGV[5])

local balance = tonumber(redis.call('get', balanceKey) or '0')
local credit = tonumber(redis.call('get', creditKey) or '0')

local covered = math.min(credit, ourfee)
ourfee = ourfee - covered

if balance - frozen < amount + tip + fee + ourfee then
    return {err = insufficientString .. ' ⚡️' .. balance - frozen .. ' / ' .. amount + tip + fee + ourfee}
end

redis.call('decrby', creditKey, tostring(math.floor(covered)))
redis.call('decrby', balanceKey, tostring(math.floor(amount + tip + fee + ourfee)))

return ourfee
`;

const REVERSE = `
local paymentKey = KEYS[1]
local balanceKey = KEYS[2]
local creditKey = KEYS[3]
local hashKey = KEYS[4]
local paymentsKey = KEYS[5]
local pid = KEYS[6]

local total = tonumber(ARGV[1])
local credit = tonumber(ARGV[2])
local hash = ARGV[3]

if redis.call('exists', paymentKey) == 1 then
    redis.call('del', paymentKey)
    redis.call('srem', 'pending', hash)
    redis.call('incrby', balanceKey, total)
    redis.call('incrby', creditKey, credit)
    redis.call('del', hashKey)
    redis.call('lrem', paymentsKey, 0, pid)
    return pid
else
    error("Payment has already been reversed" .. paymentKey)
end
`;

const debit = defineScript({
  NUMBER_OF_KEYS: 3,
  SCRIPT: DEBIT,
  transformArguments: (...args) => args.map((a) => a.toString()),
});

const reverse = defineScript({
  NUMBER_OF_KEYS: 6,
  SCRIPT: REVERSE,
  transformArguments: (...args) => args.map((a) => a.toString()),
});

export const db = createClient({
  url: config.db,
  scripts: { debit, reverse },
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
  db.set(k, JSON.stringify(v));
};

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
