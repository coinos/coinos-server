import config from "$config";
import { bech32m } from "@scure/base";

export const P2A_VALUE = 240;
export const P2A_SCRIPT = "51024e73"; // OP_1 OP_PUSHBYTES_2 0x4e73
export const CHILD_VSIZE = 152;

const P2A_WITNESS_PROGRAM = new Uint8Array([0x4e, 0x73]);
const P2A_WITNESS_VERSION = 1;

const P2A_ADDRESSES: Record<string, string> = {
  mainnet: "bc1pfeessrawgf",
  testnet: "tb1pfeessrawgf",
  signet: "tb1pfeessrawgf",
  regtest: "bcrt1pfeessrawgf",
};

const BECH32M_PREFIXES: Record<string, string> = {
  mainnet: "bc",
  testnet: "tb",
  signet: "tb",
  regtest: "bcrt",
};

function verifyP2AAddresses() {
  for (const [network, expected] of Object.entries(P2A_ADDRESSES)) {
    const prefix = BECH32M_PREFIXES[network];
    const words = [P2A_WITNESS_VERSION, ...bech32m.toWords(P2A_WITNESS_PROGRAM)];
    const encoded = bech32m.encode(prefix, words);
    if (encoded !== expected) {
      throw new Error(`P2A address mismatch for ${network}: got ${encoded}, expected ${expected}`);
    }
  }
}

verifyP2AAddresses();

export function getP2AAddress(): string {
  const network = config.bitcoin.network || "mainnet";
  return P2A_ADDRESSES[network];
}

export function isP2AOutput(scriptPubKeyHex: string): boolean {
  return scriptPubKeyHex === P2A_SCRIPT;
}

export function calculateBumpReserve(
  userRate: number,
  fastestRate: number,
  parentVsize: number,
): number {
  if (userRate >= fastestRate) return 0;
  return Math.ceil((fastestRate - userRate) * parentVsize + fastestRate * CHILD_VSIZE);
}
