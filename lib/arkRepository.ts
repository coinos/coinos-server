import type {
  WalletRepository,
  WalletState,
  ContractRepository,
  ContractFilter,
  ExtendedVirtualCoin,
  ExtendedCoin,
  ArkTransaction,
  Contract,
} from "@arkade-os/sdk";
import { db } from "$lib/db";

const PREFIX = "ark:repo";

function mergeByKey<T>(
  existing: T[],
  incoming: T[],
  toKey: (item: T) => string,
): T[] {
  const next = new Map<string, T>();
  for (const item of existing) next.set(toKey(item), item);
  for (const item of incoming) next.set(toKey(item), item);
  return Array.from(next.values());
}

function txKey(tx: ArkTransaction): string {
  const k = tx.key;
  return `${k.boardingTxid}:${k.commitmentTxid}:${k.arkTxid}`;
}

async function getJson<T>(key: string): Promise<T | null> {
  const raw = await db.get(key);
  if (!raw) return null;
  return JSON.parse(String(raw));
}

async function setJson(key: string, value: any): Promise<void> {
  await db.set(key, JSON.stringify(value));
}

export class ValkeyWalletRepository implements WalletRepository {
  readonly version = 1 as const;

  async getVtxos(address: string): Promise<ExtendedVirtualCoin[]> {
    return (await getJson(`${PREFIX}:vtxos:${address}`)) ?? [];
  }

  async saveVtxos(address: string, vtxos: ExtendedVirtualCoin[]): Promise<void> {
    const existing = await this.getVtxos(address);
    const merged = mergeByKey(existing, vtxos, (v) => `${v.txid}:${v.vout}`);
    await setJson(`${PREFIX}:vtxos:${address}`, merged);
  }

  async deleteVtxos(address: string): Promise<void> {
    await db.del(`${PREFIX}:vtxos:${address}`);
  }

  async getUtxos(address: string): Promise<ExtendedCoin[]> {
    return (await getJson(`${PREFIX}:utxos:${address}`)) ?? [];
  }

  async saveUtxos(address: string, utxos: ExtendedCoin[]): Promise<void> {
    const existing = await this.getUtxos(address);
    const merged = mergeByKey(existing, utxos, (u) => `${u.txid}:${u.vout}`);
    await setJson(`${PREFIX}:utxos:${address}`, merged);
  }

  async deleteUtxos(address: string): Promise<void> {
    await db.del(`${PREFIX}:utxos:${address}`);
  }

  async getTransactionHistory(address: string): Promise<ArkTransaction[]> {
    return (await getJson(`${PREFIX}:txs:${address}`)) ?? [];
  }

  async saveTransactions(address: string, txs: ArkTransaction[]): Promise<void> {
    const existing = await this.getTransactionHistory(address);
    const merged = mergeByKey(existing, txs, txKey);
    await setJson(`${PREFIX}:txs:${address}`, merged);
  }

  async deleteTransactions(address: string): Promise<void> {
    await db.del(`${PREFIX}:txs:${address}`);
  }

  async getWalletState(): Promise<WalletState | null> {
    return getJson(`${PREFIX}:state`);
  }

  async saveWalletState(state: WalletState): Promise<void> {
    await setJson(`${PREFIX}:state`, state);
  }

  async clear(): Promise<void> {
    const keys = await db.keys(`${PREFIX}:*`);
    if (keys.length > 0) await db.del(keys);
  }

  async [Symbol.asyncDispose](): Promise<void> {}
}

export class ValkeyContractRepository implements ContractRepository {
  readonly version = 1 as const;

  async getContracts(filter?: ContractFilter): Promise<Contract[]> {
    const all: Contract[] = (await getJson(`${PREFIX}:contracts`)) ?? [];
    if (!filter) return all;

    const matches = <T>(value: T, criterion?: T | T[]) => {
      if (criterion === undefined) return true;
      return Array.isArray(criterion)
        ? criterion.includes(value)
        : value === criterion;
    };

    return all.filter(
      (c) =>
        matches(c.script, filter.script) &&
        matches(c.state, filter.state) &&
        matches(c.type, filter.type),
    );
  }

  async saveContract(contract: Contract): Promise<void> {
    const all: Contract[] = (await getJson(`${PREFIX}:contracts`)) ?? [];
    const idx = all.findIndex((c) => c.script === contract.script);
    if (idx >= 0) all[idx] = contract;
    else all.push(contract);
    await setJson(`${PREFIX}:contracts`, all);
  }

  async deleteContract(script: string): Promise<void> {
    const all: Contract[] = (await getJson(`${PREFIX}:contracts`)) ?? [];
    const filtered = all.filter((c) => c.script !== script);
    await setJson(`${PREFIX}:contracts`, filtered);
  }

  async clear(): Promise<void> {
    await db.del(`${PREFIX}:contracts`);
  }

  async [Symbol.asyncDispose](): Promise<void> {}
}
