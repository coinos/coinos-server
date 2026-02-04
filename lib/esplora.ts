import config from "$config";
import { HDKey } from "@scure/bip32";
import { p2wpkh, NETWORK, TEST_NETWORK } from "@scure/btc-signer";

const { esploraUrl } = config.bitcoin;

const REGTEST_NETWORK = {
  bech32: "bcrt",
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

const REGTEST_VERSIONS = { private: 0x04358394, public: 0x043587cf };

const btcNetwork =
  config.bitcoin.network === "regtest"
    ? REGTEST_NETWORK
    : config.bitcoin.network === "testnet"
      ? TEST_NETWORK
      : NETWORK;

const hdVersions =
  config.bitcoin.network === "regtest" || config.bitcoin.network === "testnet"
    ? REGTEST_VERSIONS
    : undefined;

// Esplora API

export const getUtxos = async (address: string) => {
  const r = await fetch(`${esploraUrl}/address/${address}/utxo`);
  if (!r.ok) throw new Error(`esplora getUtxos: ${r.status}`);
  return r.json();
};

export const getAddressUtxos = async (addresses: string[]) => {
  const results = [];
  for (const address of addresses) {
    const utxos = await getUtxos(address);
    for (const u of utxos) {
      u.address = address;
      results.push(u);
    }
  }
  return results;
};

export const broadcastTx = async (txHex: string) => {
  const r = await fetch(`${esploraUrl}/tx`, {
    method: "POST",
    body: txHex,
    headers: { "Content-Type": "text/plain" },
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`broadcast failed: ${body}`);
  }
  return r.text();
};

export const getTxStatus = async (txid: string) => {
  const r = await fetch(`${esploraUrl}/tx/${txid}/status`);
  if (!r.ok) throw new Error(`esplora getTxStatus: ${r.status}`);
  return r.json();
};

export const getFeeEstimates = async () => {
  const r = await fetch(`${esploraUrl}/fee-estimates`);
  if (!r.ok) throw new Error(`esplora getFeeEstimates: ${r.status}`);
  return r.json();
};

export const getTx = async (txid: string) => {
  const r = await fetch(`${esploraUrl}/tx/${txid}`);
  if (!r.ok) throw new Error(`esplora getTx: ${r.status}`);
  return r.json();
};

export const getAddressTxs = async (address: string) => {
  const r = await fetch(`${esploraUrl}/address/${address}/txs`);
  if (!r.ok) throw new Error(`esplora getAddressTxs: ${r.status}`);
  return r.json();
};

export const getTxHex = async (txid: string) => {
  const r = await fetch(`${esploraUrl}/tx/${txid}/hex`);
  if (!r.ok) throw new Error(`esplora getTxHex: ${r.status}`);
  return r.text();
};

// Address derivation

const hdVersionsForKey = (pubkey: string) => {
  if (pubkey.startsWith("tpub") || pubkey.startsWith("tprv"))
    return REGTEST_VERSIONS;
  // xpub/xprv use default BITCOIN_VERSIONS (mainnet) — pass undefined
  return undefined;
};

export const deriveAddress = (
  pubkey: string,
  fingerprint: string,
  index: number,
  internal = false,
) => {
  const accountKey = HDKey.fromExtendedKey(pubkey, hdVersionsForKey(pubkey));
  const chain = internal ? 1 : 0;
  const child = accountKey.deriveChild(chain).deriveChild(index);

  const { address } = p2wpkh(child.publicKey, btcNetwork);
  const path = `m/${chain}/${index}`;

  return { address, path };
};

export const deriveAddresses = (
  pubkey: string,
  fingerprint: string,
  count: number,
  internal = false,
) => {
  const addresses = [];
  for (let i = 0; i < count; i++) {
    const { address } = deriveAddress(pubkey, fingerprint, i, internal);
    addresses.push(address);
  }
  return addresses;
};

// Migration helpers

export const parseDescriptor = (desc: string) => {
  // Parse wpkh([fingerprint]pubkey/0/*)#checksum
  const match = desc.match(/wpkh\(\[([a-f0-9]+)\]([^/]+)\/\d+\/\*\)/);
  if (!match) return null;
  return { fingerprint: match[1], pubkey: match[2] };
};

export const findLastUsedIndex = async (
  pubkey: string,
  fingerprint: string,
  maxScan = 100,
) => {
  let lastUsed = -1;
  for (let i = 0; i < maxScan; i++) {
    const { address } = deriveAddress(pubkey, fingerprint, i, false);
    const txs = await getAddressTxs(address);
    if (txs.length > 0) lastUsed = i;
  }
  return lastUsed + 1;
};

export { btcNetwork, hdVersions };
