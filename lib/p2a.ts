import config from "$config";
import { bech32m } from "@scure/base";

export const P2A_VALUE = 240;
export const P2A_SCRIPT = "51024e73"; // OP_1 OP_PUSHBYTES_2 0x4e73
export const CHILD_VSIZE = 152;

const P2A_WITNESS_PROGRAM = new Uint8Array([0x4e, 0x73]);
const P2A_WITNESS_VERSION = 1;

const BECH32M_PREFIXES: Record<string, string> = {
  mainnet: "bc",
  testnet: "tb",
  signet: "tb",
  regtest: "bcrt",
};

function encodeP2AAddress(network: string): string {
  const prefix = BECH32M_PREFIXES[network];
  if (!prefix) throw new Error(`Unknown network: ${network}`);
  const words = [P2A_WITNESS_VERSION, ...bech32m.toWords(P2A_WITNESS_PROGRAM)];
  return bech32m.encode(prefix, words);
}

export function getP2AAddress(): string {
  const network = config.bitcoin.network || "mainnet";
  return encodeP2AAddress(network);
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
