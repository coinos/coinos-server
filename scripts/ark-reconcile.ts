import config from "../config.ts";
import { SingleKey, Wallet, RestArkProvider } from "@arkade-os/sdk";
import { createClient } from "redis";

const { arkPrivateKey, arkServerUrl } = config.ark;
const esploraUrl = process.argv[2] || config.ark.esploraUrl;

// Connect to Redis on the host
const db = createClient({ url: "redis://127.0.0.1:6379" });
await db.connect();

const g = async (k: string) => {
  const v = await db.get(k);
  try { return JSON.parse(v as string); } catch { return v; }
};

// Load ark:ops log from Redis for matching
const rawOps = await db.lRange("ark:ops", 0, -1);
const arkOps: Record<string, any> = {};
for (const raw of rawOps) {
  try {
    const op = JSON.parse(raw);
    if (op.txid) arkOps[op.txid] = op;
  } catch {}
}
console.log(`Loaded ${rawOps.length} ark:ops entries (${Object.keys(arkOps).length} with txids)`);
console.log();

// Init ark wallet
const identity = SingleKey.fromHex(arkPrivateKey);
const wallet = await Wallet.create({ identity, arkServerUrl, esploraUrl });

// Get ark server info for fee rates
const provider = new RestArkProvider(arkServerUrl);
const info = await provider.getInfo();

console.log("=== Ark Server Fee Info ===");
console.log("  Fees:", JSON.stringify(info.fees, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
console.log("  Dust:", info.dust.toString(), "sats");
console.log();

// Get wallet data
const balance = await wallet.getBalance();
const history = await wallet.getTransactionHistory();
const vtxos = await wallet.getVtxos({ withRecoverable: true, withUnrolled: true });

console.log("=== Current Balance ===");
console.log("  Available:           ", balance.available, "sats");
console.log("  Settled:             ", balance.settled, "sats");
console.log("  Preconfirmed:        ", balance.preconfirmed, "sats");
console.log("  Recoverable:         ", balance.recoverable, "sats");
console.log("  Boarding (confirmed):", balance.boarding.confirmed, "sats");
console.log("  Boarding (pending):  ", balance.boarding.unconfirmed, "sats");
console.log("  Total:               ", balance.total, "sats");
console.log();

// Build a time-indexed map for matching renewal pairs
type TxEntry = typeof history[0] & { category?: string; matchedPayment?: any; renewalPairIdx?: number };
const txs: TxEntry[] = history.map(tx => ({ ...tx }));

// Index by commitment txid for pairing
const byCommitment = new Map<string, TxEntry[]>();
for (const tx of txs) {
  if (tx.key.commitmentTxid) {
    const list = byCommitment.get(tx.key.commitmentTxid) || [];
    list.push(tx);
    byCommitment.set(tx.key.commitmentTxid, list);
  }
}

// Categorize transactions
// Pass 1: identify onboards (have boardingTxid)
for (const tx of txs) {
  if (tx.key.boardingTxid) {
    tx.category = "onboard";
  }
}

// Pass 2: identify renewal pairs — SENT+RECEIVED sharing the same commitmentTxid
let pairIdx = 0;
for (const [, group] of byCommitment) {
  const sent = group.filter(t => t.type === "SENT" && !t.category);
  const recv = group.filter(t => t.type === "RECEIVED" && !t.category);
  if (sent.length > 0 && recv.length > 0) {
    for (const t of sent) { t.category = "renewal"; t.renewalPairIdx = pairIdx; }
    for (const t of recv) { t.category = "renewal"; t.renewalPairIdx = pairIdx; }
    pairIdx++;
  }
}

// Pass 3: match renewal pairs by timestamp proximity (within 120s, similar amounts)
const unmatchedSent = txs.filter(t => t.type === "SENT" && !t.category);
const unmatchedRecv = txs.filter(t => t.type === "RECEIVED" && !t.category);
const usedRecv = new Set<number>();

for (const s of unmatchedSent) {
  const sTs = s.createdAt > 1e12 ? s.createdAt / 1000 : s.createdAt;
  for (let i = 0; i < unmatchedRecv.length; i++) {
    if (usedRecv.has(i)) continue;
    const r = unmatchedRecv[i];
    const rTs = r.createdAt > 1e12 ? r.createdAt / 1000 : r.createdAt;
    if (Math.abs(sTs - rTs) < 120 && Math.abs(s.amount - r.amount) / Math.max(s.amount, r.amount) < 0.05) {
      s.category = "renewal";
      r.category = "renewal";
      s.renewalPairIdx = pairIdx;
      r.renewalPairIdx = pairIdx;
      pairIdx++;
      usedRecv.add(i);
      break;
    }
  }
}

// Pass 4: look up remaining in Redis to find user payments
for (const tx of txs) {
  if (tx.category) continue;

  const hashes: string[] = [];
  if (tx.key.arkTxid) hashes.push(tx.key.arkTxid);
  if (tx.key.commitmentTxid) hashes.push(tx.key.commitmentTxid);
  if (tx.key.boardingTxid) hashes.push(tx.key.boardingTxid);

  for (const h of hashes) {
    const directPayment = await g(`payment:${h}`);
    if (directPayment) {
      const payment = typeof directPayment === "string" ? await g(`payment:${directPayment}`) : directPayment;
      if (payment) {
        const user = payment.uid ? await g(`user:${payment.uid}`) : null;
        tx.category = "user-payment";
        tx.matchedPayment = { ...payment, username: user?.username || payment.uid };
        break;
      }
    }
  }

  if (tx.category) continue;

  for (const h of hashes) {
    const keys = await db.keys(`payment:*:${h}`);
    for (const key of keys) {
      const pid = await g(key);
      if (pid) {
        const payment = typeof pid === "string" ? await g(`payment:${pid}`) : pid;
        if (payment) {
          const user = payment.uid ? await g(`user:${payment.uid}`) : null;
          tx.category = "user-payment";
          tx.matchedPayment = { ...payment, username: user?.username || payment.uid };
          break;
        }
      }
    }
    if (tx.category) break;
  }
}

// Pass 5: match against ark:ops log
for (const tx of txs) {
  if (tx.category) continue;

  const hashes: string[] = [];
  if (tx.key.arkTxid) hashes.push(tx.key.arkTxid);
  if (tx.key.commitmentTxid) hashes.push(tx.key.commitmentTxid);
  if (tx.key.boardingTxid) hashes.push(tx.key.boardingTxid);

  for (const h of hashes) {
    const op = arkOps[h];
    if (op) {
      tx.category = `ops:${op.op}`;
      tx.matchedPayment = op;
      break;
    }
  }
}

// Pass 6: anything left is unknown
for (const tx of txs) {
  if (!tx.category) tx.category = "unknown";
}

// Print categorized history
console.log(`=== Transaction History (${txs.length} txs) ===`);
console.log();

const totals: Record<string, { count: number; sent: number; received: number }> = {};
const addTotal = (cat: string, type: string, amount: number) => {
  if (!totals[cat]) totals[cat] = { count: 0, sent: 0, received: 0 };
  totals[cat].count++;
  if (type === "SENT") totals[cat].sent += amount;
  else totals[cat].received += amount;
};

for (const tx of txs) {
  const ts = tx.createdAt > 1e12 ? tx.createdAt : tx.createdAt * 1000;
  const date = new Date(ts).toISOString();
  const sign = tx.type === "SENT" ? "-" : "+";
  const settled = tx.settled ? "settled" : "pending";
  const cat = tx.category!;

  addTotal(cat, tx.type, tx.amount);

  console.log(`${date}  ${sign}${tx.amount} sats  ${tx.type}  ${settled}  [${cat}]`);

  if (tx.key.arkTxid) console.log(`  arkTxid:    ${tx.key.arkTxid}`);
  if (tx.key.commitmentTxid) console.log(`  commitment: ${tx.key.commitmentTxid}`);
  if (tx.key.boardingTxid) console.log(`  boarding:   ${tx.key.boardingTxid}`);

  if (tx.matchedPayment) {
    const p = tx.matchedPayment;
    console.log(`  >> user: ${p.username}  amount: ${p.amount}  type: ${p.type}  aid: ${p.aid}`);
    if (p.memo) console.log(`     memo: ${p.memo}`);
  }

  console.log();
}

// Calculate renewal fees from paired transactions
const renewalPairs = new Map<number, { sent: number; received: number }>();
for (const tx of txs) {
  if (tx.category === "renewal" && tx.renewalPairIdx !== undefined) {
    const pair = renewalPairs.get(tx.renewalPairIdx) || { sent: 0, received: 0 };
    if (tx.type === "SENT") pair.sent += tx.amount;
    else pair.received += tx.amount;
    renewalPairs.set(tx.renewalPairIdx, pair);
  }
}

let totalRenewalFees = 0;
const renewalFeeList: number[] = [];
for (const [, pair] of renewalPairs) {
  const fee = pair.sent - pair.received;
  if (fee > 0) {
    totalRenewalFees += fee;
    renewalFeeList.push(fee);
  }
}

// VTXO summary
const states: Record<string, { count: number; sats: number }> = {};
for (const v of vtxos) {
  const state = v.virtualStatus?.state || "unknown";
  if (!states[state]) states[state] = { count: 0, sats: 0 };
  states[state].count++;
  states[state].sats += v.value;
}

console.log("=== VTXO Summary ===");
for (const [state, { count, sats }] of Object.entries(states)) {
  console.log(`  ${state}: ${count} vtxos, ${sats} sats`);
}
console.log();

// Reconciliation by category
console.log("=== Reconciliation by Category ===");
console.log();

let grandIn = 0, grandOut = 0;
for (const [cat, { count, sent, received }] of Object.entries(totals).sort((a, b) => b[1].sent - a[1].sent)) {
  const net = received - sent;
  grandIn += received;
  grandOut += sent;
  console.log(`  ${cat} (${count} txs)`);
  if (received) console.log(`    received: +${received} sats`);
  if (sent) console.log(`    sent:     -${sent} sats`);
  console.log(`    net:       ${net >= 0 ? "+" : ""}${net} sats`);
  if (cat === "renewal") console.log(`    fees:      ${sent - received} sats (from ${renewalPairs.size} renewal cycles)`);
  console.log();
}

console.log("  ---");
console.log(`  Total received: +${grandIn} sats`);
console.log(`  Total sent:     -${grandOut} sats`);
console.log(`  Net:             ${grandIn - grandOut >= 0 ? "+" : ""}${grandIn - grandOut} sats`);
console.log(`  Current balance: ${balance.total} sats`);
console.log();

// Fee breakdown
console.log("=== Fee Analysis ===");
console.log();

// Onboard fees: boarding amount that didn't arrive as VTXOs
const onboardSent = totals["onboard"]?.sent || 0;
const onboardRecv = totals["onboard"]?.received || 0;
const onboardFees = onboardSent - onboardRecv; // usually 0 sent, so this may not apply
// For onboards, fees = amount boarded on-chain minus amount received as VTXOs
// We can't easily measure this without knowing the on-chain boarding amounts
// But we can note what arrived

console.log("  Renewal fees:");
console.log(`    Total:   ${totalRenewalFees} sats across ${renewalPairs.size} cycles`);
if (renewalFeeList.length > 0) {
  renewalFeeList.sort((a, b) => a - b);
  console.log(`    Min:     ${renewalFeeList[0]} sats`);
  console.log(`    Max:     ${renewalFeeList[renewalFeeList.length - 1]} sats`);
  console.log(`    Avg:     ${Math.round(totalRenewalFees / renewalFeeList.length)} sats`);
  console.log(`    Median:  ${renewalFeeList[Math.floor(renewalFeeList.length / 2)]} sats`);
}
console.log();

// Unknown category analysis — likely unmatched renewals/recoveries
const unknownSent = totals["unknown"]?.sent || 0;
const unknownRecv = totals["unknown"]?.received || 0;
console.log("  Unknown/unmatched:");
console.log(`    Sent:     ${unknownSent} sats`);
console.log(`    Received: ${unknownRecv} sats`);
console.log(`    Net loss: ${unknownSent - unknownRecv} sats`);
console.log();

const userPaymentSent = totals["user-payment"]?.sent || 0;
const userPaymentRecv = totals["user-payment"]?.received || 0;
console.log("  User payments (ark sends to external addresses):");
console.log(`    Sent:     ${userPaymentSent} sats`);
console.log(`    Received: ${userPaymentRecv} sats`);
console.log();

const totalMaintenanceCost = totalRenewalFees + (unknownSent - unknownRecv);
console.log("  === TOTAL MAINTENANCE COST ===");
console.log(`    Renewal fees:           ${totalRenewalFees} sats`);
console.log(`    Unknown net loss:       ${unknownSent - unknownRecv} sats`);
console.log(`    ---------------------------------`);
console.log(`    Total overhead:         ${totalMaintenanceCost} sats`);
console.log();

// Timeline analysis — when did costs occur
const firstTx = txs[txs.length - 1];
const lastTx = txs[0];
if (firstTx && lastTx) {
  const firstTs = firstTx.createdAt > 1e12 ? firstTx.createdAt : firstTx.createdAt * 1000;
  const lastTs = lastTx.createdAt > 1e12 ? lastTx.createdAt : lastTx.createdAt * 1000;
  const days = (lastTs - firstTs) / (1000 * 60 * 60 * 24);
  console.log("  === COST RATE ===");
  console.log(`    History spans:          ${days.toFixed(1)} days`);
  if (days > 0) {
    console.log(`    Maintenance cost/day:   ${Math.round(totalMaintenanceCost / days)} sats/day`);
    console.log(`    Maintenance cost/month: ${Math.round(totalMaintenanceCost / days * 30)} sats/month`);
    console.log(`    Renewal cycles/day:     ${(renewalPairs.size / days).toFixed(1)}`);
  }
}
console.log();

await db.quit();
