#!/usr/bin/env bun
// Find users exhibiting the "lightning in, liquid out" pattern that drains the
// liquid hot wallet (forcing the liquid threshold down). For each user in the
// window, sum receives/sends per rail and surface those who take in meaningful
// lightning and push out meaningful liquid.
//
// Usage: bun scripts/ln-liquid-arb.ts [--days N] [--min SATS] [--top N]

import { createClient } from "redis";

const argDays = Number(process.argv[process.argv.indexOf("--days") + 1]) || 14;
const MIN = Number(process.argv[process.argv.indexOf("--min") + 1]) || 500_000;
const TOP = Number(process.argv[process.argv.indexOf("--top") + 1]) || 30;
const cutoff = Date.now() - argDays * 24 * 60 * 60 * 1000;

const db = createClient({ url: "redis://127.0.0.1:6379", socket: { reconnectStrategy: () => false } });
await db.connect();

const fmt = (n: number) => n.toLocaleString("en-US");

// uid -> username
const uname = new Map<string, string>();
async function loadNames() {
  let batch: string[] = [];
  const drain = async () => {
    if (!batch.length) return;
    const vals = await db.mGet(batch);
    for (const v of vals) {
      if (!v || v[0] !== "{") continue;
      try { const u = JSON.parse(v); if (u.id && u.username) uname.set(u.id, u.username); } catch {}
    }
    batch = [];
  };
  for await (const k of db.scanIterator({ MATCH: "user:*", COUNT: 1000 })) {
    batch.push(k as string);
    if (batch.length >= 500) await drain();
  }
  await drain();
}
await loadNames();
const nameOf = (uid: string) => uname.get(uid) || uid.slice(0, 8);

// Per user per rail: { in, out } sats
type Rail = { in: number; out: number; inN: number; outN: number };
const RAILS = ["lightning", "liquid", "bitcoin", "internal", "bolt12", "fund"];
const stats = new Map<string, Record<string, Rail>>();
const ensure = (uid: string) => {
  let s = stats.get(uid);
  if (!s) {
    s = {};
    for (const r of RAILS) s[r] = { in: 0, out: 0, inN: 0, outN: 0 };
    stats.set(uid, s);
  }
  return s;
};

let scanned = 0;
let batch: string[] = [];
const drainP = async () => {
  if (!batch.length) return;
  const vals = await db.mGet(batch);
  for (const v of vals) {
    if (!v || v[0] !== "{") continue;
    let p: any; try { p = JSON.parse(v); } catch { continue; }
    if (!p.created || p.created < cutoff || typeof p.amount !== "number" || !p.uid) continue;
    const rail = p.type;
    if (!RAILS.includes(rail)) continue;
    const s = ensure(p.uid)[rail];
    if (p.amount >= 0) { s.in += p.amount; s.inN++; }
    else { s.out += Math.abs(p.amount); s.outN++; }
  }
  batch = [];
};
for await (const k of db.scanIterator({ MATCH: "payment:*", COUNT: 2000 })) {
  scanned++;
  batch.push(k as string);
  if (batch.length >= 1000) await drainP();
}
await drainP();

// The arb pattern: significant lightning IN and significant liquid OUT.
const flagged = [...stats.entries()]
  .map(([uid, s]) => ({
    uid,
    lnIn: s.lightning.in,
    lqOut: s.liquid.out,
    bolt12In: s.bolt12.in,
    arb: Math.min(s.lightning.in + s.bolt12.in, s.liquid.out), // overlap = the through-flow
    s,
  }))
  .filter((x) => x.lqOut >= MIN && x.lnIn + x.bolt12In >= MIN)
  .sort((a, b) => b.arb - a.arb)
  .slice(0, TOP);

console.log("═".repeat(72));
console.log(`  LIGHTNING-IN / LIQUID-OUT pattern — last ${argDays} days (min ${fmt(MIN)} sats each side)`);
console.log("═".repeat(72));
console.log(`  walked ${fmt(scanned)} payment keys\n`);

if (!flagged.length) {
  console.log("  No users matched the pattern at this threshold.");
} else {
  console.log("  user                  ln_in       bolt12_in    liquid_out    through-flow");
  for (const x of flagged) {
    console.log(
      `  ${nameOf(x.uid).padEnd(20)} ${fmt(x.lnIn).padStart(11)} ${fmt(x.bolt12In).padStart(11)} ${fmt(x.lqOut).padStart(13)} ${fmt(x.arb).padStart(13)}`,
    );
  }
  const totalThrough = flagged.reduce((s, x) => s + x.arb, 0);
  console.log(`\n  Combined through-flow (ln/bolt12 in -> liquid out): ${fmt(totalThrough)} sats`);
}

// Also: who are the biggest NET liquid drainers regardless of funding source?
const netLiquid = [...stats.entries()]
  .map(([uid, s]) => ({ uid, net: s.liquid.out - s.liquid.in, out: s.liquid.out }))
  .filter((x) => x.net >= MIN)
  .sort((a, b) => b.net - a.net)
  .slice(0, 15);
console.log("\n" + "─".repeat(72));
console.log("  TOP NET LIQUID DRAINERS (liquid_out - liquid_in, any funding source)");
console.log("─".repeat(72));
for (const x of netLiquid) {
  console.log(`  ${nameOf(x.uid).padEnd(20)} net out ${fmt(x.net).padStart(13)} (gross out ${fmt(x.out)})`);
}
console.log("═".repeat(72));
process.exit(0);
