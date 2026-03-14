import { SingleKey, Wallet } from "@arkade-os/sdk";
import { createClient } from "redis";

const { ark: { arkPrivateKey, arkServerUrl, esploraUrl } } = (await import("../config.ts")).default;

const redis = createClient({ url: "redis://localhost" });
await redis.connect();

// Inline minimal Valkey repos to avoid pulling in the full app
const PREFIX = "ark:repo";
const walletRepository = {
  version: 1 as const,
  async getVtxos(address: string) { const r = await redis.get(`${PREFIX}:vtxos:${address}`); return r ? JSON.parse(r) : []; },
  async saveVtxos(address: string, vtxos: any[]) { const existing = await this.getVtxos(address); const map = new Map(); for (const v of existing) map.set(`${v.txid}:${v.vout}`, v); for (const v of vtxos) map.set(`${v.txid}:${v.vout}`, v); await redis.set(`${PREFIX}:vtxos:${address}`, JSON.stringify([...map.values()])); },
  async deleteVtxos(address: string) { await redis.del(`${PREFIX}:vtxos:${address}`); },
  async getUtxos(address: string) { const r = await redis.get(`${PREFIX}:utxos:${address}`); return r ? JSON.parse(r) : []; },
  async saveUtxos(address: string, utxos: any[]) { const existing = await this.getUtxos(address); const map = new Map(); for (const u of existing) map.set(`${u.txid}:${u.vout}`, u); for (const u of utxos) map.set(`${u.txid}:${u.vout}`, u); await redis.set(`${PREFIX}:utxos:${address}`, JSON.stringify([...map.values()])); },
  async deleteUtxos(address: string) { await redis.del(`${PREFIX}:utxos:${address}`); },
  async getTransactionHistory(address: string) { const r = await redis.get(`${PREFIX}:txs:${address}`); return r ? JSON.parse(r) : []; },
  async saveTransactions(address: string, txs: any[]) { await redis.set(`${PREFIX}:txs:${address}`, JSON.stringify(txs)); },
  async deleteTransactions(address: string) { await redis.del(`${PREFIX}:txs:${address}`); },
  async getWalletState() { const r = await redis.get(`${PREFIX}:state`); return r ? JSON.parse(r) : null; },
  async saveWalletState(state: any) { await redis.set(`${PREFIX}:state`, JSON.stringify(state)); },
  async clear() { const keys = await redis.keys(`${PREFIX}:*`); if (keys.length) await redis.del(keys); },
  async [Symbol.asyncDispose]() {},
};

const contractRepository = {
  version: 1 as const,
  async getContracts(filter?: any) { const r = await redis.get(`${PREFIX}:contracts`); const all = r ? JSON.parse(r) : []; if (!filter) return all; return all.filter((c: any) => (!filter.script || c.script === filter.script) && (!filter.state || c.state === filter.state) && (!filter.type || c.type === filter.type)); },
  async saveContract(contract: any) { const all = await this.getContracts(); const idx = all.findIndex((c: any) => c.script === contract.script); if (idx >= 0) all[idx] = contract; else all.push(contract); await redis.set(`${PREFIX}:contracts`, JSON.stringify(all)); },
  async deleteContract(script: string) { const all = await this.getContracts(); await redis.set(`${PREFIX}:contracts`, JSON.stringify(all.filter((c: any) => c.script !== script))); },
  async clear() { await redis.del(`${PREFIX}:contracts`); },
  async [Symbol.asyncDispose]() {},
};

const identity = SingleKey.fromHex(arkPrivateKey);
const wallet = await Wallet.create({
  identity,
  arkServerUrl,
  esploraUrl,
  storage: { walletRepository, contractRepository },
});

const address = await wallet.getBoardingAddress();
const balance = await wallet.getBalance();
const utxos = await wallet.getBoardingUtxos();

console.log("Boarding address:", address);
console.log();
console.log("Balance:");
console.log("  Available:           ", balance.available, "sats");
console.log("  Recoverable:         ", balance.recoverable, "sats");
console.log("  Boarding (confirmed):", balance.boarding.confirmed, "sats");
console.log("  Boarding (pending):  ", balance.boarding.unconfirmed, "sats");
console.log();
console.log("Boarding UTXOs:", utxos.length);
for (const u of utxos) {
  const status = u.status?.confirmed ? "confirmed" : "unconfirmed";
  console.log(`  ${u.txid}:${u.vout} — ${u.value} sats (${status})`);
}

await redis.quit();
process.exit(0);
