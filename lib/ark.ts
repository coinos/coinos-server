import { EventSource } from "eventsource";
if (!globalThis.EventSource) globalThis.EventSource = EventSource as any;

import config from "$config";
import { SingleKey, Wallet, Ramps, RestArkProvider, VtxoManager } from "@arkade-os/sdk";
import { ValkeyWalletRepository, ValkeyContractRepository } from "$lib/arkRepository";
import { db } from "$lib/db";
import { l, warn } from "$lib/logging";

// Log ark wallet operations to Redis for auditing/reconciliation
const logArkOp = async (op: string, details: Record<string, any>) => {
  const entry = { op, ts: Date.now(), ...details };
  await db.lPush("ark:ops", JSON.stringify(entry));
  await db.lTrim("ark:ops", 0, 9999);
};

let wallet: any;

const getWallet = async () => {
  if (wallet) return wallet;

  const { arkPrivateKey, arkServerUrl, esploraUrl } = config.ark;
  const identity = SingleKey.fromHex(arkPrivateKey);

  wallet = await Wallet.create({
    identity,
    arkServerUrl,
    esploraUrl,
    storage: {
      walletRepository: new ValkeyWalletRepository(),
      contractRepository: new ValkeyContractRepository(),
    },
  });
  return wallet;
};

let refreshing = false;
let lastRefresh = 0;
const REFRESH_COOLDOWN = 300_000;
let failedBoardingOutpoints = new Set<string>();
const FAILED_BOARDING_KEY = "ark:failedBoardingOutpoints";
const loadFailedOutpoints = async () => {
  const members = await db.sMembers(FAILED_BOARDING_KEY);
  failedBoardingOutpoints = new Set(members);
};
loadFailedOutpoints();

let recoveryFailures = 0;
let renewalFailures = 0;
const MAX_FAILURES_BEFORE_BACKOFF = 3;
const BACKOFF_CYCLES = 30; // skip ~30 cycles (30 min at 60s interval)
let recoverySkipUntil = 0;
let renewalSkipUntil = 0;

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string) =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);

export const refreshArkWallet = async (force = false) => {
  const now = Date.now();
  if (refreshing || (!force && now - lastRefresh < REFRESH_COOLDOWN)) return;
  try {
    refreshing = true;
    lastRefresh = now;
    const w = await getWallet();
    const balance = await w.getBalance();
    cachedArkBalance = balance;
    const manager = new VtxoManager(w);
    const provider = new RestArkProvider(config.ark.arkServerUrl);
    const info = await provider.getInfo();
    const dust = Number(info.dust);

    const recoverableDisplay = balance.recoverable > dust ? balance.recoverable : 0;
    l(
      "ark wallet check — available:",
      balance.available,
      "recoverable:",
      recoverableDisplay,
      "boarding:",
      balance.boarding.confirmed,
      "pending:",
      balance.boarding.unconfirmed,
    );

    // Recover swept/expired VTXOs (with backoff on repeated failures)
    const recoverableAboveDust = balance.recoverable > dust;
    if (recoverableAboveDust && now >= recoverySkipUntil) {
      try {
        const txid = await withTimeout(manager.recoverVtxos(), 60_000, "ark recovery");
        l("ark recovered swept vtxos, txid:", txid);
        await logArkOp("recovery", { txid, amount: balance.recoverable });
        recoveryFailures = 0;
      } catch (e: any) {
        if (/no recoverable/i.test(e.message)) {
          l("ark recovery: no recoverable vtxos above dust");
        } else {
          recoveryFailures++;
          if (recoveryFailures >= MAX_FAILURES_BEFORE_BACKOFF) {
            recoverySkipUntil = Date.now() + BACKOFF_CYCLES * 60_000;
            warn("ark vtxo recovery failed", recoveryFailures, "times, backing off 30m");
          } else {
            warn("ark vtxo recovery failed:", e.message);
          }
        }
      }
    }

    // Renew VTXOs approaching expiry (with backoff on repeated failures)
    // 1h threshold — default SDK is 24h which causes excessive renewals/fees
    const RENEWAL_THRESHOLD_MS = 60 * 60 * 1000;
    if (now >= renewalSkipUntil) {
      try {
        const allExpiring = await manager.getExpiringVtxos(RENEWAL_THRESHOLD_MS);
        const expiring = allExpiring.filter((v: any) => v.value > Number(info.dust));
        if (expiring.length > 0) {
          const expiringTotal = expiring.reduce((s: number, v: any) => s + v.value, 0);
          l("ark renewing", expiring.length, "expiring vtxos, total:", expiringTotal, "sats (skipped", allExpiring.length - expiring.length, "dust)");
          const txid = await withTimeout(manager.renewVtxos(), 60_000, "ark renewal");
          l("ark renewed vtxos, txid:", txid);
          await logArkOp("renewal", { txid, vtxoCount: expiring.length, amount: expiringTotal });
          renewalFailures = 0;
        }
      } catch (e: any) {
        renewalFailures++;
        if (renewalFailures >= MAX_FAILURES_BEFORE_BACKOFF) {
          renewalSkipUntil = Date.now() + BACKOFF_CYCLES * 60_000;
          warn("ark vtxo renewal failed", renewalFailures, "times, backing off 30m");
        } else {
          warn("ark vtxo renewal failed:", e.message);
        }
      }
    }

    // Onboard confirmed boarding UTXOs
    const boardingUtxos = await w.getBoardingUtxos();
    const confirmed = boardingUtxos.filter((u: any) => u.status?.confirmed);

    if (confirmed.length > 0) {
      const ramps = new Ramps(w);

      // Try each boarding UTXO, freshest first, skipping known failures
      const outpointKey = (u: any) => `${u.txid}:${u.vout}`;
      const sorted = [...confirmed]
        .filter((u: any) => !failedBoardingOutpoints.has(outpointKey(u)))
        .sort((a: any, b: any) => (b.status?.block_height || 0) - (a.status?.block_height || 0));

      // Suppress SDK "Unknown event type" console.warn during onboard
      const origWarn = console.warn;
      console.warn = (...args: any[]) => {
        if (typeof args[0] === "string" && args[0].includes("Unknown event type")) return;
        origWarn.apply(console, args);
      };

      for (const utxo of sorted) {
        try {
          const txid = await withTimeout(
            ramps.onboard(info.fees, [utxo], undefined, (event) => l("ark onboard event:", JSON.stringify(event, (_, v) => typeof v === "bigint" ? v.toString() : v))),
            60_000,
            "ark onboard",
          );
          l("ark onboarded boarding utxo:", utxo.value, "sats, txid:", txid);
          await logArkOp("onboard", { txid, amount: utxo.value, boardingTxid: utxo.txid, vout: utxo.vout });
          failedBoardingOutpoints.clear();
          await db.del(FAILED_BOARDING_KEY);
          break;
        } catch (e: any) {
          const retriable = /not enough intent confirmations|timed out|signing_session/i.test(e.message);
          if (!retriable) {
            failedBoardingOutpoints.add(outpointKey(utxo));
            await db.sAdd(FAILED_BOARDING_KEY, outpointKey(utxo));
          }
          warn("ark onboard failed:", utxo.value, "sats:", e.message);
        }
      }

      console.warn = origWarn;
    }
  } catch (e: any) {
    warn("ark wallet refresh failed:", e.message);
  } finally {
    refreshing = false;
  }
};

// Initial check after 60s startup delay; retry every 60s to catch ark rounds
if (config.ark?.arkPrivateKey) {
  setTimeout(refreshArkWallet, 60_000);
  setInterval(() => refreshArkWallet(), 60_000);
}


export const sendArk = async (address: string, amount: number) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Ark send timed out")), 60000),
  );
  const send = async () => {
    let w = await getWallet();
    try {
      const txid = await w.sendBitcoin({ address, amount });
      await logArkOp("send", { txid, address, amount });
      return txid;
    } catch (e: any) {
      if (/insufficient funds/i.test(e.message) || /VTXO_RECOVERABLE/i.test(e.message) || /VTXO_ALREADY_SPENT/i.test(e.message) || /VTXO_ALREADY_REGISTERED/i.test(e.message)) {
        l("ark send failed:", e.message, "— recreating wallet and retrying");
        wallet = null;
        await refreshArkWallet(true);
        w = await getWallet();
        const txid = await w.sendBitcoin({ address, amount });
        await logArkOp("send", { txid, address, amount });
        return txid;
      }
      throw e;
    }
  };
  return Promise.race([send(), timeout]);
};

export const getArkAddress = async () => {
  const w = await getWallet();
  return w.getAddress();
};

let cachedArkBalance: any = null;

export const getArkBalance = () => cachedArkBalance;

export const verifyArkVtxo = async (hash: string) => {
  const { bech32m } = await import("@scure/base");
  const serverAddr = await getArkAddress();
  const decoded = bech32m.decode(serverAddr, 1023);
  const words = new Uint8Array(bech32m.fromWords(decoded.words));
  const vtxoHex = Buffer.from(words.slice(33, 65)).toString("hex");
  const r = await fetch(
    `${config.ark.arkServerUrl}/v1/indexer/vtxos?scripts=5120${vtxoHex}&spendable_only=true`,
  );
  const { vtxos } = await r.json() as any;
  return vtxos?.some((v: any) => v.outpoint?.txid === hash) ?? false;
};
