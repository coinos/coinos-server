#!/usr/bin/env bun
// One-time cleanup: remove duplicate entries from every `<id>:invoices` list.
//
// Background: `generate()` used to `lPush` the invoice id onto the owner's
// `:invoices` list every time it ran — including when regenerating an existing
// invoice (adding a tip, webhook, etc.). That pushed the same id multiple times,
// so a user's `/invoices` response contained duplicate records. The UI's keyed
// `{#each}` then threw `each_key_duplicate` and rendered a blank page. The source
// is fixed in lib/invoices.ts (only push when the id is brand new); this script
// cleans the dupes that already accumulated.
//
// Dedup preserves the ORIGINAL position of each id. The list is newest-first
// (lPush adds to the head), and re-pushes added newer copies at the head, so the
// deepest (tail-most) occurrence is the original creation push — we keep that one.
//
// Read-only by default (dry run). Pass --apply to actually rewrite lists.
// Usage: bun scripts/dedup-invoices.ts [--apply]

import { createClient } from "redis";

const apply = process.argv.includes("--apply");

const db = createClient({
  url: "redis://127.0.0.1:6379",
  socket: { reconnectStrategy: () => false },
});
await db.connect();

// Keep the LAST occurrence of each id (original creation order), preserving
// the relative order of the kept entries.
function dedupeKeepLast(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const id = list[i];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  out.reverse();
  return out;
}

let lists = 0;
let listsWithDupes = 0;
let entriesBefore = 0;
let entriesRemoved = 0;
const worst: { key: string; before: number; after: number }[] = [];

for await (const k of db.scanIterator({ MATCH: "*:invoices", COUNT: 2000 })) {
  const keys = Array.isArray(k) ? k : [k];
  for (const key of keys) {
    lists++;
    const list = await db.lRange(key, 0, -1);
    entriesBefore += list.length;
    const deduped = dedupeKeepLast(list);
    const removed = list.length - deduped.length;
    if (removed === 0) continue;

    listsWithDupes++;
    entriesRemoved += removed;
    worst.push({ key, before: list.length, after: deduped.length });

    if (apply) {
      // Rewrite atomically: DEL then RPUSH the deduped list (RPUSH keeps head->tail order).
      const tx = db.multi();
      tx.del(key);
      tx.rPush(key, deduped);
      await tx.exec();
    }
  }
}

worst.sort((a, b) => b.before - b.after - (a.before - a.after));

console.log(`\n${apply ? "APPLIED" : "DRY RUN (use --apply to write)"}`);
console.log(`lists scanned:        ${lists}`);
console.log(`lists with dupes:     ${listsWithDupes}`);
console.log(`entries before:       ${entriesBefore}`);
console.log(`duplicate entries:    ${entriesRemoved}`);
console.log(`\ntop 10 most-duplicated lists:`);
for (const w of worst.slice(0, 10)) {
  console.log(`  ${w.key}  ${w.before} -> ${w.after}  (-${w.before - w.after})`);
}

await db.quit();
