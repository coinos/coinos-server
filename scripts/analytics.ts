#!/usr/bin/env bun
// Coinos analytics report. Streams the live `db` (SCAN, never KEYS) and
// aggregates payment + balance + user data into an insight report.
//
// Usage:
//   bun scripts/analytics.ts [--days N] [--top N] [--json] [--csv PATH]
//
// Defaults: --days 30, --top 20. Reads only the live db (redis://127.0.0.1:6379);
// archived payments (older, in `arc`) are out of scope for the trailing window.
// --csv appends one metrics row to PATH (writing a header if the file is new),
// for month-over-month trend tracking; the human report still prints to stdout.

import { createClient } from "redis";
import { appendFileSync, existsSync } from "fs";

const argDays = Number(process.argv[process.argv.indexOf("--days") + 1]) || 30;
const TOP = Number(process.argv[process.argv.indexOf("--top") + 1]) || 20;
const asJson = process.argv.includes("--json");
const csvIdx = process.argv.indexOf("--csv");
const csvPath = csvIdx >= 0 ? process.argv[csvIdx + 1] : null;

const now = Date.now();
const cutoff = now - argDays * 24 * 60 * 60 * 1000;

const db = createClient({
  url: "redis://127.0.0.1:6379",
  socket: { reconnectStrategy: () => false },
});
await db.connect();

const fmtSats = (n: number) =>
  n.toLocaleString("en-US") + " sats";
const fmtBtc = (n: number) => (n / 1e8).toFixed(3) + " BTC";

// ---- helpers ---------------------------------------------------------------

async function* scanGetJSON(match: string, count = 1000) {
  // Stream keys matching `match`, fetch values in pipelined batches, yield
  // parsed JSON objects (skips non-JSON / mapping-string keys).
  let batch: string[] = [];
  async function* drain() {
    if (!batch.length) return;
    const vals = await db.mGet(batch);
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (!v || v[0] !== "{") continue; // skip mapping strings / nulls
      try {
        yield [batch[i], JSON.parse(v)] as [string, any];
      } catch {}
    }
    batch = [];
  }
  for await (const key of db.scanIterator({ MATCH: match, COUNT: count })) {
    batch.push(key as string);
    if (batch.length >= 500) yield* drain();
  }
  yield* drain();
}

// ---- pass 1: usernames (uid -> username) -----------------------------------
// user:<uid> is the full record; user:<username> is a string pointer we skip.

const uname = new Map<string, string>();
let userRecords = 0;
let newUsers = 0; // created in window (if `created` present on user)
for await (const [key, u] of scanGetJSON("user:*")) {
  if (!u?.id || !u?.username) continue;
  uname.set(u.id, u.username);
  userRecords++;
  if (u.created && u.created >= cutoff) newUsers++;
}

const nameOf = (uid: string) => uname.get(uid) || uid.slice(0, 8);

// ---- pass 2: balances (holders) --------------------------------------------

type Holder = { uid: string; bal: number };
const holders: Holder[] = [];
let totalCustodied = 0;
for await (const key of db.scanIterator({ MATCH: "balance:*", COUNT: 1000 })) {
  const uid = (key as string).slice("balance:".length);
  const v = await db.get(key as string);
  const bal = Number(v) || 0;
  if (bal > 0) {
    holders.push({ uid, bal });
    totalCustodied += bal;
  }
}
holders.sort((a, b) => b.bal - a.bal);

// ---- pass 3: payments (the heavy walk) -------------------------------------

const TYPES = [
  "lightning",
  "liquid",
  "bitcoin",
  "internal",
  "bolt12",
  "ecash",
  "fund",
  "reconcile",
] as const;

type Agg = { count: number; volume: number; sent: number; received: number };
const byType: Record<string, Agg> = {};
for (const t of TYPES) byType[t] = { count: 0, volume: 0, sent: 0, received: 0 };

const activeUids = new Set<string>();
const weekActive = new Set<string>(); // last 7d
const perUser = new Map<string, { count: number; volume: number }>();
const bolt12Recipients = new Map<string, number>(); // uid -> # bolt12 receives
let feeRevenue = 0;
let paymentsInWindow = 0;
let largest: { uid: string; amount: number; type: string } | null = null;
const dayBuckets = new Map<string, number>(); // YYYY-MM-DD -> count

const weekCutoff = now - 7 * 24 * 60 * 60 * 1000;

let scanned = 0;
const t0 = Date.now();
for await (const [key, p] of scanGetJSON("payment:*", 2000)) {
  scanned++;
  if (!p?.created || typeof p.amount !== "number" || !p.uid) continue;
  if (p.created < cutoff) continue;

  paymentsInWindow++;
  const uid = p.uid;
  const type = p.type || "unknown";
  const amt = p.amount;
  const abs = Math.abs(amt);

  const agg = byType[type] || (byType[type] = { count: 0, volume: 0, sent: 0, received: 0 });
  agg.count++;
  agg.volume += abs;
  if (amt < 0) agg.sent += abs;
  else agg.received += abs;

  activeUids.add(uid);
  if (p.created >= weekCutoff) weekActive.add(uid);

  const pu = perUser.get(uid) || { count: 0, volume: 0 };
  pu.count++;
  pu.volume += abs;
  perUser.set(uid, pu);

  if (type === "bolt12" && amt > 0) {
    bolt12Recipients.set(uid, (bolt12Recipients.get(uid) || 0) + 1);
  }

  if (typeof p.fee === "number") feeRevenue += p.fee;
  if (typeof p.ourfee === "number") feeRevenue += p.ourfee;

  if (!largest || abs > largest.amount) largest = { uid, amount: abs, type };

  const day = new Date(p.created).toISOString().slice(0, 10);
  dayBuckets.set(day, (dayBuckets.get(day) || 0) + 1);
}
const walkSecs = ((Date.now() - t0) / 1000).toFixed(1);

// ---- derive ----------------------------------------------------------------

const mostActive = [...perUser.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, TOP);
const highestVolume = [...perUser.entries()]
  .sort((a, b) => b[1].volume - a[1].volume)
  .slice(0, TOP);

// "Regular" bolt12 recipients = received via bolt12 on multiple distinct days
// would be ideal, but receive-count >= 4 in the window is a good proxy for the
// Ocean mining-reward stream.
const regularBolt12 = [...bolt12Recipients.entries()].filter(([, n]) => n >= 4);
regularBolt12.sort((a, b) => b[1] - a[1]);

const totalVolume = Object.values(byType).reduce((s, a) => s + a.volume, 0);

// ---- CSV append (trend tracking) -------------------------------------------
// One row per run. Stable column set so months line up; per-type volume/count
// columns let us chart the lightning/liquid/bitcoin/internal/bolt12 mix over
// time. Written before stdout output so it happens in both text and --json modes.
if (csvPath) {
  const typeCols = ["lightning", "liquid", "bitcoin", "internal", "bolt12", "fund"];
  const header = [
    "date",
    "window_days",
    "users_total",
    "new_users",
    "mau",
    "wau",
    "payments",
    "total_volume_sats",
    "custodied_sats",
    "holders",
    "fee_revenue_sats",
    "bolt12_recipients",
    "regular_bolt12",
    ...typeCols.flatMap((t) => [`${t}_vol`, `${t}_txns`]),
  ];
  const row = [
    new Date(now).toISOString().slice(0, 10),
    argDays,
    userRecords,
    newUsers,
    activeUids.size,
    weekActive.size,
    paymentsInWindow,
    totalVolume,
    totalCustodied,
    holders.length,
    feeRevenue,
    bolt12Recipients.size,
    regularBolt12.length,
    ...typeCols.flatMap((t) => [byType[t]?.volume || 0, byType[t]?.count || 0]),
  ];
  const fresh = !existsSync(csvPath);
  appendFileSync(csvPath, (fresh ? header.join(",") + "\n" : "") + row.join(",") + "\n");
  // To stderr so it doesn't pollute the saved stdout report / --json output.
  console.error(`[csv] appended row to ${csvPath}`);
}

// ---- output ----------------------------------------------------------------

if (asJson) {
  console.log(
    JSON.stringify(
      {
        window_days: argDays,
        generated_at: new Date(now).toISOString(),
        users_total: userRecords,
        new_users_in_window: newUsers,
        mau: activeUids.size,
        wau: weekActive.size,
        payments_in_window: paymentsInWindow,
        total_volume_sats: totalVolume,
        total_custodied_sats: totalCustodied,
        fee_revenue_sats: feeRevenue,
        by_type: byType,
        top_holders: holders.slice(0, TOP).map((h) => ({ user: nameOf(h.uid), bal: h.bal })),
        most_active: mostActive.map(([uid, v]) => ({ user: nameOf(uid), ...v })),
        highest_volume: highestVolume.map(([uid, v]) => ({ user: nameOf(uid), ...v })),
        bolt12_recipients: bolt12Recipients.size,
        regular_bolt12_recipients: regularBolt12.length,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const line = (s = "") => console.log(s);
const bar = (n: number, max: number, width = 30) =>
  "█".repeat(Math.round((n / max) * width)) + "·".repeat(width - Math.round((n / max) * width));

line("═".repeat(64));
line(`  COINOS ANALYTICS — last ${argDays} days  (${new Date(now).toISOString().slice(0, 16)}Z)`);
line(`  walked ${scanned.toLocaleString()} payment keys in ${walkSecs}s`);
line("═".repeat(64));

line("\n▏USERS");
line(`  Total user records ........ ${userRecords.toLocaleString()}`);
line(`  New users (window) ........ ${newUsers.toLocaleString()}`);
line(`  MAU (active ${argDays}d) ......... ${activeUids.size.toLocaleString()}`);
line(`  WAU (active 7d) ........... ${weekActive.size.toLocaleString()}`);
line(`  Payments (window) ......... ${paymentsInWindow.toLocaleString()}`);

line("\n▏CUSTODY");
line(`  Total custodied ........... ${fmtSats(totalCustodied)}  (${fmtBtc(totalCustodied)})`);
line(`  Holders (>0 bal) .......... ${holders.length.toLocaleString()}`);
line(`  Fee revenue (window) ...... ${fmtSats(feeRevenue)}`);

line("\n▏NETWORK VOLUME (gross sats moved, window)");
const typesSorted = Object.entries(byType)
  .filter(([, a]) => a.count > 0)
  .sort((a, b) => b[1].volume - a[1].volume);
const maxVol = Math.max(...typesSorted.map(([, a]) => a.volume), 1);
for (const [t, a] of typesSorted) {
  const pct = ((a.volume / totalVolume) * 100).toFixed(1);
  line(`  ${t.padEnd(10)} ${bar(a.volume, maxVol, 24)} ${pct.padStart(5)}%  ${a.count.toLocaleString()} txns`);
  line(`             ${fmtSats(a.volume).padEnd(22)} (${fmtBtc(a.volume)})`);
}

line("\n▏TOP HOLDERS");
holders.slice(0, TOP).forEach((h, i) =>
  line(`  ${String(i + 1).padStart(2)}. ${nameOf(h.uid).padEnd(24)} ${fmtSats(h.bal)}`),
);

line("\n▏MOST ACTIVE USERS (by payment count)");
mostActive.forEach(([uid, v], i) =>
  line(`  ${String(i + 1).padStart(2)}. ${nameOf(uid).padEnd(24)} ${v.count.toLocaleString()} txns, ${fmtSats(v.volume)}`),
);

line("\n▏HIGHEST VOLUME USERS (gross sats moved)");
highestVolume.forEach(([uid, v], i) =>
  line(`  ${String(i + 1).padStart(2)}. ${nameOf(uid).padEnd(24)} ${fmtSats(v.volume)} (${v.count} txns)`),
);

line("\n▏BOLT12 (Ocean mining rewards etc.)");
line(`  Distinct bolt12 recipients ........ ${bolt12Recipients.size.toLocaleString()}`);
line(`  Regular recipients (>=4 receives) . ${regularBolt12.length.toLocaleString()}`);
regularBolt12.slice(0, TOP).forEach(([uid, n], i) =>
  line(`  ${String(i + 1).padStart(2)}. ${nameOf(uid).padEnd(24)} ${n} bolt12 receives`),
);

if (largest)
  line(`\n  Largest single payment: ${fmtSats(largest.amount)} (${largest.type}) by ${nameOf(largest.uid)}`);

line("\n" + "═".repeat(64));
process.exit(0);
