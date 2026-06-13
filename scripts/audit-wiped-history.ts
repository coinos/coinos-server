#!/usr/bin/env bun
// Find accounts whose payment history index was wiped — the changeid bug
// signature, distinct from the harmless arc-only archived state.
//
// Two buckets:
//   wiped-with-balance:  balance > 0 but :payments list is empty in BOTH db and
//     arc. Real funds, no visible history. These are the changeid-rekeyed
//     accounts (password == "reset") whose list entries got dropped. Highest
//     priority — user sees a balance with no transactions.
//   wiped-no-balance:    :payments empty in both, balance 0, but has :invoices
//     (so they did transact once). History gone but nothing owed; lower priority.
//
// Read-only. Usage: bun scripts/audit-wiped-history.ts [--full] [--examples N]

import { createClient } from "redis";

const full = process.argv.includes("--full");
const exN = Number(process.argv[process.argv.indexOf("--examples") + 1]) || 30;

const db = createClient({ url: "redis://127.0.0.1:6379", socket: { reconnectStrategy: () => false } });
const arc = createClient({ url: "redis://127.0.0.1:6380", socket: { reconnectStrategy: () => false } });
await db.connect();
await arc.connect();

let scanned = 0;
const wipedWithBal: { name: string; uid: string; bal: number; reset: boolean }[] = [];
const wipedNoBal: { name: string; uid: string; invoices: number }[] = [];
let cleanCount = 0;

const t0 = Date.now();
for await (const batch of db.scanIterator({ MATCH: "user:*", COUNT: 2000 })) {
  // This redis client version yields ARRAYS of keys per iteration, not single keys.
  const keys = Array.isArray(batch) ? batch : [batch];
  for (const key of keys) {
  const uid = (key as string).slice("user:".length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(uid)) continue; // skip username pointers
  scanned++;

  const dbLen = await db.lLen(`${uid}:payments`);
  if (dbLen > 0) { cleanCount++; continue; } // has visible history

  // Empty in db — is it also empty in arc, or just archived?
  const arcLen = await arc.lLen(`${uid}:payments`);
  if (arcLen > 0) { cleanCount++; continue; } // renders via gf(), fine

  // :payments empty in both. Does it matter? Check balance + whether they ever transacted.
  const bal = parseInt((await db.get(`balance:${uid}`)) || "0", 10);
  const invLen = await db.lLen(`${uid}:invoices`);

  if (bal > 0) {
    const u = await db.get(`user:${uid}`);
    let name = uid.slice(0, 8), reset = false;
    if (u && u[0] === "{") { try { const j = JSON.parse(u); name = j.username || name; reset = j.password === "reset"; } catch {} }
    wipedWithBal.push({ name, uid, bal, reset });
  } else if (invLen > 0) {
    const u = await db.get(`user:${uid}`);
    let name = uid.slice(0, 8);
    if (u && u[0] === "{") { try { name = JSON.parse(u).username || name; } catch {} }
    wipedNoBal.push({ name, uid, invoices: invLen });
  }
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);

wipedWithBal.sort((a, b) => b.bal - a.bal);

console.log("═".repeat(70));
console.log(`  WIPED-HISTORY AUDIT — scanned ${scanned} users in ${secs}s`);
console.log("═".repeat(70));
console.log(`\n  Accounts with BALANCE but no history (priority — funds visible, no txns):`);
console.log(`    count: ${wipedWithBal.length}`);
const totalBal = wipedWithBal.reduce((s, x) => s + x.bal, 0);
console.log(`    total balance affected: ${totalBal.toLocaleString()} sats`);
console.log(`    (of which password=="reset" / changeid'd: ${wipedWithBal.filter((x) => x.reset).length})`);
console.log("");
for (const x of wipedWithBal.slice(0, exN)) {
  console.log(`    ${x.name.padEnd(24)} ${(x.bal + "").padStart(12)} sats  ${x.reset ? "[changeid]" : ""}  ${x.uid}`);
}

console.log(`\n  Accounts wiped, no balance (had invoices, lower priority): ${wipedNoBal.length}`);
for (const x of wipedNoBal.slice(0, 10)) {
  console.log(`    ${x.name.padEnd(24)} ${x.invoices} invoices  ${x.uid}`);
}
console.log("═".repeat(70));
process.exit(0);
