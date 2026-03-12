import config from "../config.ts";
import { SingleKey, Wallet } from "@arkade-os/sdk";

const { arkPrivateKey, arkServerUrl } = config.ark;
const esploraUrl = process.argv[2] || config.ark.esploraUrl;
const identity = SingleKey.fromHex(arkPrivateKey);
const wallet = await Wallet.create({ identity, arkServerUrl, esploraUrl });

const balance = await wallet.getBalance();
console.log("=== Current Balance ===");
console.log("  Available:           ", balance.available, "sats");
console.log("  Settled:             ", balance.settled, "sats");
console.log("  Preconfirmed:        ", balance.preconfirmed, "sats");
console.log("  Recoverable:         ", balance.recoverable, "sats");
console.log("  Boarding (confirmed):", balance.boarding.confirmed, "sats");
console.log("  Boarding (pending):  ", balance.boarding.unconfirmed, "sats");
console.log("  Total:               ", balance.total, "sats");
console.log();

const history = await wallet.getTransactionHistory();
console.log(`=== Transaction History (${history.length} txs) ===`);
for (const tx of history) {
  const date = new Date(tx.createdAt * 1000).toISOString();
  const sign = tx.type === "SENT" ? "-" : "+";
  const settled = tx.settled ? "settled" : "pending";
  console.log(`  ${date}  ${sign}${tx.amount} sats  ${tx.type}  ${settled}`);
  if (tx.key.boardingTxid) console.log(`    boarding: ${tx.key.boardingTxid}`);
  if (tx.key.commitmentTxid) console.log(`    commitment: ${tx.key.commitmentTxid}`);
  if (tx.key.arkTxid) console.log(`    arkTxid: ${tx.key.arkTxid}`);
  console.log();
}

const vtxos = await wallet.getVtxos({ withRecoverable: true, withUnrolled: true });
console.log(`=== VTXOs (${vtxos.length}) ===`);
for (const v of vtxos) {
  const state = v.virtualStatus?.state || "unknown";
  const spent = v.spentBy ? `spent by ${v.spentBy}` : "";
  const settled = v.settledBy ? `settled by ${v.settledBy}` : "";
  const created = v.createdAt ? new Date(v.createdAt).toISOString() : "";
  const expiry = v.virtualStatus?.batchExpiry
    ? new Date(v.virtualStatus.batchExpiry * 1000).toISOString()
    : "";
  console.log(`  ${v.txid}:${v.vout}  ${v.value} sats  ${state}  ${created}`);
  if (expiry) console.log(`    expires: ${expiry}`);
  if (spent) console.log(`    ${spent}`);
  if (settled) console.log(`    ${settled}`);
  console.log();
}
