import { EventSource } from "eventsource";
if (!globalThis.EventSource) globalThis.EventSource = EventSource;
import { SingleKey, Wallet } from "@arkade-os/sdk";

const key = "0ebe9a690651e9e08d7c2f4db106d8ec264725241fdb34c57aedb26155b0e027";
const identity = SingleKey.fromHex(key);
const wallet = await Wallet.create({ identity, arkServerUrl: "http://localhost:7070" });

const balance = await wallet.getBalance();
console.log("Balance:", JSON.stringify(balance));

console.log("Settling...");
try {
  const txid = await wallet.settle();
  console.log("Settle txid:", txid);

  const balanceAfter = await wallet.getBalance();
  console.log("Balance after:", JSON.stringify(balanceAfter));
} catch(e: any) {
  console.error("Error:", e.message);
}

process.exit(0);
