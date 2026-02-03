import { EventSource } from "eventsource";
if (!globalThis.EventSource) globalThis.EventSource = EventSource;

import config from "$config";
import { SingleKey, Wallet } from "@arkade-os/sdk";

let wallet: any;

const getWallet = async () => {
  if (wallet) return wallet;

  const { arkPrivateKey, arkServerUrl } = config.ark;
  const identity = SingleKey.fromHex(arkPrivateKey);

  wallet = await Wallet.create({ identity, arkServerUrl });
  return wallet;
};

export const sendArk = async (address: string, amount: number) => {
  const w = await getWallet();
  return w.sendBitcoin({ address, amount });
};

export const getArkAddress = async () => {
  const w = await getWallet();
  return w.getAddress();
};

export const getArkBalance = async () => {
  const w = await getWallet();
  return w.getBalance();
};
