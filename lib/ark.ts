import { EventSource } from "eventsource";
if (!globalThis.EventSource) globalThis.EventSource = EventSource;

import config from "$config";
import { SingleKey, Wallet } from "@arkade-os/sdk";

let wallet: any;

const getWallet = async () => {
  if (wallet) return wallet;

  const { arkPrivateKey, arkServerUrl, esploraUrl } = config.ark;
  const identity = SingleKey.fromHex(arkPrivateKey);

  wallet = await Wallet.create({ identity, arkServerUrl, esploraUrl });
  return wallet;
};

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
