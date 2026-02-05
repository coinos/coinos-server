import config from "$config";
import { warn } from "$lib/logging";
import {
  createClient,
  CreateAccountError,
  AccountFlags,
  TransferFlags,
} from "tigerbeetle-node";

let client: any;

// Ledger IDs
const LEDGER_SATS = 1;
const LEDGER_CREDIT_BTC = 2;
const LEDGER_CREDIT_LN = 3;
const LEDGER_CREDIT_LQ = 4;

const creditLedger: Record<string, number> = {
  bitcoin: LEDGER_CREDIT_BTC,
  lightning: LEDGER_CREDIT_LN,
  liquid: LEDGER_CREDIT_LQ,
};

// House account IDs match their ledger
const HOUSE_SATS = 1n;
const HOUSE_BTC = 2n;
const HOUSE_LN = 3n;
const HOUSE_LQ = 4n;

const houseCreditAccount: Record<string, bigint> = {
  bitcoin: HOUSE_BTC,
  lightning: HOUSE_LN,
  liquid: HOUSE_LQ,
};

// Convert UUID string to BigInt
function uuidToBigInt(uuid: string): bigint {
  const hex = uuid.replace(/-/g, "");
  return BigInt(`0x${hex}`);
}

// ID derivation
function balanceId(aid: string): bigint {
  return uuidToBigInt(aid);
}

function pendingId(aid: string): bigint {
  return uuidToBigInt(aid) ^ (5n << 64n);
}

function creditId(uid: string, type: string): bigint {
  const ledger = BigInt(creditLedger[type] || 0);
  return uuidToBigInt(uid) ^ (ledger << 64n);
}

function u128(n: bigint): bigint {
  return n & ((1n << 128n) - 1n);
}

async function resolveAddresses(addresses: string[]): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");
  const resolved: string[] = [];
  for (const addr of addresses) {
    const [host, port] = addr.split(":");
    try {
      const { address: ip } = await lookup(host);
      resolved.push(`${ip}:${port}`);
    } catch {
      resolved.push(addr);
    }
  }
  return resolved;
}

export async function initTigerBeetle() {
  const { cluster_id, replica_addresses } = config.tigerbeetle;
  const resolved = await resolveAddresses(replica_addresses);
  client = createClient({ cluster_id, replica_addresses: resolved });

  // Create house accounts (no flags = no constraints)
  const houseAccounts = [
    { id: u128(HOUSE_SATS), ledger: LEDGER_SATS, code: 1 },
    { id: u128(HOUSE_BTC), ledger: LEDGER_CREDIT_BTC, code: 1 },
    { id: u128(HOUSE_LN), ledger: LEDGER_CREDIT_LN, code: 1 },
    { id: u128(HOUSE_LQ), ledger: LEDGER_CREDIT_LQ, code: 1 },
  ].map((a) => ({
    id: a.id,
    debits_pending: 0n,
    debits_posted: 0n,
    credits_pending: 0n,
    credits_posted: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    reserved: 0,
    ledger: a.ledger,
    code: a.code,
    flags: 0,
    timestamp: 0n,
  }));

  const results = await client.createAccounts(houseAccounts);
  for (const r of results) {
    if (r.result !== CreateAccountError.exists) {
      warn("TB house account creation:", r.index, r.result);
    }
  }
}

export async function createBalanceAccount(aid: string) {
  const accounts = [
    {
      id: u128(balanceId(aid)),
      ledger: LEDGER_SATS,
      code: 1,
      flags: AccountFlags.debits_must_not_exceed_credits,
    },
    {
      id: u128(pendingId(aid)),
      ledger: LEDGER_SATS,
      code: 1,
      flags: AccountFlags.debits_must_not_exceed_credits,
    },
  ].map((a) => ({
    ...a,
    debits_pending: 0n,
    debits_posted: 0n,
    credits_pending: 0n,
    credits_posted: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    reserved: 0,
    timestamp: 0n,
  }));

  const results = await client.createAccounts(accounts);
  for (const r of results) {
    if (r.result !== CreateAccountError.exists) {
      warn("TB balance account creation:", r.index, r.result);
    }
  }
}

export async function createCreditAccounts(uid: string) {
  const accounts = ["bitcoin", "lightning", "liquid"].map((type) => ({
    id: u128(creditId(uid, type)),
    ledger: creditLedger[type],
    code: 1,
    flags: AccountFlags.debits_must_not_exceed_credits,
    debits_pending: 0n,
    debits_posted: 0n,
    credits_pending: 0n,
    credits_posted: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    reserved: 0,
    timestamp: 0n,
  }));

  const results = await client.createAccounts(accounts);
  for (const r of results) {
    if (r.result !== CreateAccountError.exists) {
      warn("TB credit account creation:", r.index, r.result);
    }
  }
}

async function getAccount(id: bigint) {
  const accounts = await client.lookupAccounts([u128(id)]);
  if (accounts.length === 0) return null;
  return accounts[0];
}

function accountBalance(account: any): number {
  if (!account) return 0;
  return Number(account.credits_posted - account.debits_posted);
}

export async function getBalance(aid: string): Promise<number> {
  const account = await getAccount(balanceId(aid));
  return accountBalance(account);
}

export async function getPending(aid: string): Promise<number> {
  const account = await getAccount(pendingId(aid));
  return accountBalance(account);
}

export async function getCredit(uid: string, type: string): Promise<number> {
  const account = await getAccount(creditId(uid, type));
  return accountBalance(account);
}

let transferIdCounter = BigInt(Date.now()) << 64n;
function nextTransferId(): bigint {
  transferIdCounter += 1n;
  return u128(transferIdCounter);
}

export async function tbDebit(
  aid: string,
  uid: string,
  creditType: string,
  amount: number,
  tip: number,
  fee: number,
  ourfee: number,
  frozen: number,
  errMsg: string,
): Promise<number> {
  // Look up credit balance
  let covered = 0;
  if (ourfee > 0 && creditType && creditLedger[creditType]) {
    const creditBal = await getCredit(
      uid === aid ? uid : "00000000-0000-0000-0000-000000000000",
      creditType,
    );
    covered = Math.min(creditBal, ourfee);
    ourfee -= covered;
  }

  const totalDebit = amount + tip + fee + ourfee;

  // Check balance is sufficient (accounting for frozen funds)
  const currentBalance = await getBalance(aid);
  if (currentBalance - frozen < totalDebit) {
    return {
      err: `${errMsg} ⚡️${currentBalance - frozen} / ${totalDebit}`,
    } as any;
  }

  // Build linked transfers
  const transfers: any[] = [];

  // 1. Consume credits (user credit → house credit) if any
  if (covered > 0) {
    const creditUserAcctId = creditId(
      uid === aid ? uid : "00000000-0000-0000-0000-000000000000",
      creditType,
    );
    transfers.push({
      id: nextTransferId(),
      debit_account_id: u128(creditUserAcctId),
      credit_account_id: u128(houseCreditAccount[creditType]),
      amount: BigInt(covered),
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: creditLedger[creditType],
      code: 1,
      flags: 0, // linked flag set below
      timestamp: 0n,
    });
  }

  // 2. Debit balance (user → house)
  transfers.push({
    id: nextTransferId(),
    debit_account_id: u128(balanceId(aid)),
    credit_account_id: u128(HOUSE_SATS),
    amount: BigInt(totalDebit),
    pending_id: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    timeout: 0,
    ledger: LEDGER_SATS,
    code: 1,
    flags: 0,
    timestamp: 0n,
  });

  // Link all but the last transfer
  const linked = TransferFlags.linked;

  for (let i = 0; i < transfers.length - 1; i++) {
    transfers[i].flags |= linked;
  }

  const results = await client.createTransfers(transfers);
  if (results.length > 0) {
    return {
      err: `${errMsg} ⚡️${currentBalance - frozen} / ${totalDebit}`,
    } as any;
  }

  return ourfee;
}

export async function tbCredit(
  aid: string,
  uid: string,
  creditType: string,
  amount: number,
  isPending: boolean,
) {
  const transfers: any[] = [];

  // Transfer house → user balance (or house → pending)
  const targetAccount = isPending ? pendingId(aid) : balanceId(aid);
  transfers.push({
    id: nextTransferId(),
    debit_account_id: u128(HOUSE_SATS),
    credit_account_id: u128(targetAccount),
    amount: BigInt(amount),
    pending_id: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    timeout: 0,
    ledger: LEDGER_SATS,
    code: 1,
    flags: 0,
    timestamp: 0n,
  });

  // Add fee credit if applicable
  if (creditType && creditLedger[creditType] && config.fee[creditType]) {
    const creditAmount = Math.round(amount * config.fee[creditType]);
    if (creditAmount > 0) {
      transfers.push({
        id: nextTransferId(),
        debit_account_id: u128(houseCreditAccount[creditType]),
        credit_account_id: u128(creditId(uid, creditType)),
        amount: BigInt(creditAmount),
        pending_id: 0n,
        user_data_128: 0n,
        user_data_64: 0n,
        user_data_32: 0,
        timeout: 0,
        ledger: creditLedger[creditType],
        code: 1,
        flags: 0,
        timestamp: 0n,
      });
    }
  }

  const results = await client.createTransfers(transfers);
  for (const r of results) {
    warn("TB credit transfer error:", r.index, r.result);
  }
}

export async function tbConfirm(aid: string, amount: number) {
  // Transfer pending → balance (via house as intermediary)
  const linked = TransferFlags.linked;

  const transfers = [
    {
      id: nextTransferId(),
      debit_account_id: u128(pendingId(aid)),
      credit_account_id: u128(HOUSE_SATS),
      amount: BigInt(amount),
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: LEDGER_SATS,
      code: 1,
      flags: linked,
      timestamp: 0n,
    },
    {
      id: nextTransferId(),
      debit_account_id: u128(HOUSE_SATS),
      credit_account_id: u128(balanceId(aid)),
      amount: BigInt(amount),
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: LEDGER_SATS,
      code: 1,
      flags: 0,
      timestamp: 0n,
    },
  ];

  const results = await client.createTransfers(transfers);
  for (const r of results) {
    warn("TB confirm transfer error:", r.index, r.result);
  }
}

export async function tbReverse(
  uid: string,
  total: number,
  creditAmount: number,
) {
  const transfers: any[] = [];
  const linked = TransferFlags.linked;

  // House → user balance
  transfers.push({
    id: nextTransferId(),
    debit_account_id: u128(HOUSE_SATS),
    credit_account_id: u128(balanceId(uid)),
    amount: BigInt(total),
    pending_id: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    timeout: 0,
    ledger: LEDGER_SATS,
    code: 1,
    flags: creditAmount > 0 ? linked : 0,
    timestamp: 0n,
  });

  // House credit → user credit (lightning)
  if (creditAmount > 0) {
    transfers.push({
      id: nextTransferId(),
      debit_account_id: u128(HOUSE_LN),
      credit_account_id: u128(creditId(uid, "lightning")),
      amount: BigInt(creditAmount),
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: LEDGER_CREDIT_LN,
      code: 1,
      flags: 0,
      timestamp: 0n,
    });
  }

  const results = await client.createTransfers(transfers);
  for (const r of results) {
    warn("TB reverse transfer error:", r.index, r.result);
  }
}

export async function tbRefund(uid: string, amount: number) {
  if (amount <= 0) return;

  const transfers = [
    {
      id: nextTransferId(),
      debit_account_id: u128(HOUSE_SATS),
      credit_account_id: u128(balanceId(uid)),
      amount: BigInt(amount),
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: LEDGER_SATS,
      code: 1,
      flags: 0,
      timestamp: 0n,
    },
  ];

  const results = await client.createTransfers(transfers);
  for (const r of results) {
    warn("TB refund transfer error:", r.index, r.result);
  }
}

export async function tbSetBalance(aid: string, target: number) {
  const current = await getBalance(aid);
  const diff = target - current;
  if (diff === 0) return;

  const transfers = [
    {
      id: nextTransferId(),
      debit_account_id: diff > 0 ? u128(HOUSE_SATS) : u128(balanceId(aid)),
      credit_account_id: diff > 0 ? u128(balanceId(aid)) : u128(HOUSE_SATS),
      amount: BigInt(Math.abs(diff)),
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: LEDGER_SATS,
      code: 1,
      flags: 0,
      timestamp: 0n,
    },
  ];

  const results = await client.createTransfers(transfers);
  for (const r of results) {
    warn("TB setBalance transfer error:", r.index, r.result);
  }
}

export async function tbSetPending(aid: string, target: number) {
  const current = await getPending(aid);
  const diff = target - current;
  if (diff === 0) return;

  const transfers = [
    {
      id: nextTransferId(),
      debit_account_id: diff > 0 ? u128(HOUSE_SATS) : u128(pendingId(aid)),
      credit_account_id: diff > 0 ? u128(pendingId(aid)) : u128(HOUSE_SATS),
      amount: BigInt(Math.abs(diff)),
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: LEDGER_SATS,
      code: 1,
      flags: 0,
      timestamp: 0n,
    },
  ];

  const results = await client.createTransfers(transfers);
  for (const r of results) {
    warn("TB setPending transfer error:", r.index, r.result);
  }
}

export async function tbSetCredit(uid: string, type: string, target: number) {
  const current = await getCredit(uid, type);
  const diff = target - current;
  if (diff === 0) return;

  const ledger = creditLedger[type];
  if (!ledger) return;

  const transfers = [
    {
      id: nextTransferId(),
      debit_account_id: diff > 0 ? u128(houseCreditAccount[type]) : u128(creditId(uid, type)),
      credit_account_id: diff > 0 ? u128(creditId(uid, type)) : u128(houseCreditAccount[type]),
      amount: BigInt(Math.abs(diff)),
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger,
      code: 1,
      flags: 0,
      timestamp: 0n,
    },
  ];

  const results = await client.createTransfers(transfers);
  for (const r of results) {
    warn("TB setCredit transfer error:", r.index, r.result);
  }
}

// Debit from a fund:* key (Redis only, no credits)
export async function fundDebit(
  fundKey: string,
  amount: number,
  errMsg: string,
): Promise<any> {
  const { db } = await import("$lib/db");
  const bal = Number.parseInt((await db.get(fundKey)) || "0");
  if (bal < amount) {
    return { err: `${errMsg} ⚡️${bal} / ${amount}` };
  }
  await db.decrBy(fundKey, amount);
  return 0;
}
