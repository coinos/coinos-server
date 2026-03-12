import config from "../config.ts";
import { SingleKey, Wallet } from "@arkade-os/sdk";

const { arkPrivateKey, arkServerUrl } = config.ark;
const esploraUrl = process.argv[2] || config.ark.esploraUrl;
const identity = SingleKey.fromHex(arkPrivateKey);
const wallet = await Wallet.create({ identity, arkServerUrl, esploraUrl });

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
