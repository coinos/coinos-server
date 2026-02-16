import { EventSource } from "eventsource";
if (!globalThis.EventSource) globalThis.EventSource = EventSource;

import config from "$config";
import {
  SingleKey,
  Wallet,
  Ramps,
  RestArkProvider,
  VtxoManager,
} from "@arkade-os/sdk";
import { l, warn } from "$lib/logging";

let wallet: any;

const getWallet = async () => {
  if (wallet) return wallet;

  const { arkPrivateKey, arkServerUrl, esploraUrl } = config.ark;
  const identity = SingleKey.fromHex(arkPrivateKey);

  wallet = await Wallet.create({ identity, arkServerUrl, esploraUrl });
  return wallet;
};

let refreshing = false;
const failedBoardingOutpoints = new Set<string>();

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string) =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms),
    ),
  ]);

export const refreshArkWallet = async () => {
  if (refreshing) return;
  try {
    refreshing = true;
    const w = await getWallet();
    const balance = await w.getBalance();
    l(
      "ark wallet check — available:",
      balance.available,
      "recoverable:",
      balance.recoverable,
      "boarding:",
      balance.boarding.confirmed,
    );

    const manager = new VtxoManager(w);

    // Recover swept/expired VTXOs
    if (balance.recoverable > 0) {
      try {
        const txid = await withTimeout(
          manager.recoverVtxos(),
          60_000,
          "ark recovery",
        );
        l("ark recovered swept vtxos, txid:", txid);
      } catch (e: any) {
        warn("ark vtxo recovery failed:", e.message);
      }
    }

    // Renew VTXOs approaching expiry (SDK default: 3 days)
    try {
      const expiring = await manager.getExpiringVtxos();
      if (expiring.length > 0) {
        l("ark renewing", expiring.length, "expiring vtxos");
        const txid = await withTimeout(
          manager.renewVtxos(),
          60_000,
          "ark renewal",
        );
        l("ark renewed vtxos, txid:", txid);
      }
    } catch (e: any) {
      warn("ark vtxo renewal failed:", e.message);
    }

    // Onboard confirmed boarding UTXOs
    const boardingUtxos = await w.getBoardingUtxos();
    const confirmed = boardingUtxos.filter((u: any) => u.status?.confirmed);

    if (confirmed.length > 0) {
      const provider = new RestArkProvider(config.ark.arkServerUrl);
      const info = await provider.getInfo();
      const ramps = new Ramps(w);

      // Try each boarding UTXO, freshest first, skipping known failures
      const outpointKey = (u: any) => `${u.txid}:${u.vout}`;
      const sorted = [...confirmed]
        .filter((u: any) => !failedBoardingOutpoints.has(outpointKey(u)))
        .sort(
          (a: any, b: any) =>
            (b.status?.block_height || 0) - (a.status?.block_height || 0),
        );

      for (const utxo of sorted) {
        try {
          const txid = await withTimeout(
            ramps.onboard(info.fees, [utxo], undefined, () => {}),
            60_000,
            "ark onboard",
          );
          l("ark onboarded boarding utxo:", utxo.value, "sats, txid:", txid);
          failedBoardingOutpoints.clear();
          break;
        } catch (e: any) {
          failedBoardingOutpoints.add(outpointKey(utxo));
          warn("ark onboard failed:", utxo.value, "sats:", e.message);
        }
      }
    }
  } catch (e: any) {
    warn("ark wallet refresh failed:", e.message);
  } finally {
    refreshing = false;
  }
};

// Check every 2 minutes
setInterval(refreshArkWallet, 2 * 60 * 1000);
// Initial check after 30s startup delay
setTimeout(refreshArkWallet, 30_000);

export const sendArk = async (address: string, amount: number) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Ark send timed out")), 45000),
  );
  const send = async () => {
    const w = await getWallet();
    return w.sendBitcoin({ address, amount });
  };
  return Promise.race([send(), timeout]);
};

export const getArkAddress = async () => {
  const w = await getWallet();
  return w.getAddress();
};

export const getArkBalance = async () => {
  const w = await getWallet();
  return w.getBalance();
};

export const verifyArkVtxo = async (hash: string) => {
  const { bech32m } = await import("@scure/base");
  const serverAddr = await getArkAddress();
  const decoded = bech32m.decode(serverAddr, 1023);
  const words = new Uint8Array(bech32m.fromWords(decoded.words));
  const vtxoHex = Buffer.from(words.slice(33, 65)).toString("hex");
  const r = await fetch(
    `http://arkd:7070/v1/indexer/vtxos?scripts=5120${vtxoHex}&spendable_only=true`,
  );
  const { vtxos } = await r.json();
  return vtxos?.some((v: any) => v.outpoint?.txid === hash) ?? false;
};
