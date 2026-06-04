#!/usr/bin/env bun
// Audit how widespread missing payment history is and classify WHY.
//
// For each user with a non-empty :payments list, check each referenced
// payment:<id> across db and arc, and bucket the user:
//   - clean:        all records resolve (db or arc)
//   - recoverable:  some/all records missing from db but present in arc
//   - lost:         some records missing from BOTH db and arc (true loss)
// Also records per-payment counts so we can size a restore.
//
// Read-only. Samples by default; pass --full to scan every user (slower).
// Usage: bun scripts/audit-missing-history.ts [--full] [--sample N] [--examples N]

import { createClient } from "redis";

const full = process.argv.includes("--full");
const sampleN = Number(process.argv[process.argv.indexOf("--sample") + 1]) || 4000;
const exN = Number(process.argv[process.argv.indexOf("--examples") + 1]) || 15;

const db = createClient({ url: "redis://127.0.0.1:6379", socket: { reconnectStrategy: () => false } });
const arc = createClient({ url: "redis://127.0.0.1:6380", socket: { reconnectStrategy: () => false } });
await db.connect();
await arc.connect();

// Resolve uid -> username lazily (only for examples) to keep memory low.
async function nameOf(uid: string) {
  const u = await db.get(`user:${uid}`);
  if (u && u[0] === "{") { try { return JSON.parse(u).username || uid.slice(0, 8); } catch {} }
  return uid.slice(0, 8);
}

let usersScanned = 0;
let usersWithPayments = 0;
const bucket = { clean: 0, recoverable: 0, lost: 0 };
let totalRefs = 0, inDb = 0, inArcOnly = 0, missingBoth = 0;
const examples: { recoverable: string[]; lost: string[] } = { recoverable: [], lost: [] };

// Helper: does payment:<id> exist in db / arc? (batched EXISTS)
async function classifyUser(uid: string): Promise<"clean" | "recoverable" | "lost" | null> {
  const pids = await db.lRange(`${uid}:payments`, 0, -1);
  if (!pids.length) return null;
  usersWithPayments++;

  let anyArcOnly = false, anyMissing = false;
  for (const pid of pids) {
    totalRefs++;
    const key = `payment:${pid}`;
    const dbHas = await db.exists(key);
    if (dbHas) { inDb++; continue; }
    const arcHas = await arc.exists(key);
    if (arcHas) { inArcOnly++; anyArcOnly = true; }
    else { missingBoth++; anyMissing = true; }
  }
  if (anyMissing) return "lost";
  if (anyArcOnly) return "recoverable";
  return "clean";
}

const t0 = Date.now();
let processed = 0;
for await (const key of db.scanIterator({ MATCH: "user:*", COUNT: 1000 })) {
  // Only the canonical record key user:<uuid> (skip user:<username> pointers).
  const id = (key as string).slice("user:".length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(id)) continue;
  usersScanned++;
  if (!full && usersScanned > sampleN) break;

  const cls = await classifyUser(id);
  if (!cls) continue;
  bucket[cls]++;
  if (cls === "recoverable" && examples.recoverable.length < exN) examples.recoverable.push(id);
  if (cls === "lost" && examples.lost.length < exN) examples.lost.push(id);
  processed++;
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const totalClassified = bucket.clean + bucket.recoverable + bucket.lost;
const pct = (n: number) => totalClassified ? ((n / totalClassified) * 100).toFixed(1) + "%" : "0%";

console.log("═".repeat(66));
console.log(`  MISSING-HISTORY AUDIT — ${full ? "FULL scan" : `sample of ${sampleN} users`}`);
console.log(`  scanned ${usersScanned} user records, ${usersWithPayments} with payments, in ${secs}s`);
console.log("═".repeat(66));
console.log(`\n  Users with payment history: ${totalClassified}`);
console.log(`    clean (all records present) ...... ${bucket.clean}  (${pct(bucket.clean)})`);
console.log(`    recoverable (in arc, not db) ..... ${bucket.recoverable}  (${pct(bucket.recoverable)})  <- restorable`);
console.log(`    lost (missing from db AND arc) ... ${bucket.lost}  (${pct(bucket.lost)})  <- true loss`);
console.log(`\n  Payment records referenced: ${totalRefs}`);
console.log(`    in db ............ ${inDb}  (${((inDb/totalRefs)*100||0).toFixed(1)}%)`);
console.log(`    in arc only ...... ${inArcOnly}  (${((inArcOnly/totalRefs)*100||0).toFixed(1)}%)  <- restorable`);
console.log(`    missing both ..... ${missingBoth}  (${((missingBoth/totalRefs)*100||0).toFixed(1)}%)  <- gone`);

if (examples.recoverable.length) {
  console.log(`\n  Example RECOVERABLE users:`);
  for (const uid of examples.recoverable) console.log(`    ${await nameOf(uid)}  (${uid})`);
}
if (examples.lost.length) {
  console.log(`\n  Example LOST-record users:`);
  for (const uid of examples.lost) console.log(`    ${await nameOf(uid)}  (${uid})`);
}
if (!full) {
  const est = Math.round((bucket.recoverable / Math.min(usersScanned, sampleN)) * usersScanned);
  console.log(`\n  (sample only — run --full for exact totals)`);
}
console.log("═".repeat(66));
process.exit(0);
