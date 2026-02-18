import config from "$config";
import { warn } from "$lib/logging";
import {
  createClient,
  CreateAccountError,
  AccountFlags,
  TransferFlags,
} from "tigerbeetle-node";
import { createHash } from "crypto";

let client: any;

// Ledger IDs
const LEDGER_SATS = 1;
const LEDGER_CREDIT_BTC = 2;
const LEDGER_CREDIT_LN = 3;
const LEDGER_CREDIT_LQ = 4;

// Microsatoshi precision: 1 sat = 1,000,000 microsats
const MSATS = 1_000_000n; // BigInt for TB operations
const MSATS_NUM = 1_000_000; // Number for JS math

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

function fundAccountId(name: string): bigint {
  const hash = createHash("sha256").update(`fund:${name}`).digest("hex");
  return BigInt(`0x${hash.slice(0, 32)}`) ^ (6n << 64n);
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

// Raw microsats balance for internal use
function accountBalanceMicro(account: any): bigint {
  if (!account) return 0n;
  return account.credits_posted - account.debits_posted;
}

function accountBalance(account: any): number {
  if (!account) return 0;
  const micro = account.credits_posted - account.debits_posted;
  return Number(micro / MSATS); // Floor division to sats
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
  // Look up credit balance in microsats for precision
  let coveredMicro = 0n;
  if (ourfee > 0 && creditType && creditLedger[creditType]) {
    const creditAcct = await getAccount(
      creditId(
        uid === aid ? uid : "00000000-0000-0000-0000-000000000000",
        creditType,
      ),
    );
    const creditBalMicro = accountBalanceMicro(creditAcct);
    const ourfeeMicro = BigInt(ourfee) * MSATS;
    coveredMicro = creditBalMicro < ourfeeMicro ? creditBalMicro : ourfeeMicro;
    ourfee = Number((ourfeeMicro - coveredMicro) / MSATS);
  }

  // Total debit in microsats
  const totalDebitMicro = BigInt(amount + tip + fee + ourfee) * MSATS;

  // Check balance is sufficient (accounting for frozen funds) in microsats
  const balAcct = await getAccount(balanceId(aid));
  const currentBalMicro = accountBalanceMicro(balAcct);
  const frozenMicro = BigInt(frozen) * MSATS;
  if (currentBalMicro - frozenMicro < totalDebitMicro) {
    const availSats = Number((currentBalMicro - frozenMicro) / MSATS);
    const needSats = Number(totalDebitMicro / MSATS);
    return {
      err: `${errMsg} ⚡️${availSats} / ${needSats}`,
    } as any;
  }

  // Build linked transfers
  const transfers: any[] = [];

  // 1. Consume credits (user credit → house credit) if any - in microsats
  if (coveredMicro > 0n) {
    const creditUserAcctId = creditId(
      uid === aid ? uid : "00000000-0000-0000-0000-000000000000",
      creditType,
    );
    transfers.push({
      id: nextTransferId(),
      debit_account_id: u128(creditUserAcctId),
      credit_account_id: u128(houseCreditAccount[creditType]),
      amount: coveredMicro,
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

  // 2. Debit balance (user → house) in microsats
  transfers.push({
    id: nextTransferId(),
    debit_account_id: u128(balanceId(aid)),
    credit_account_id: u128(HOUSE_SATS),
    amount: totalDebitMicro,
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
    const availSats = Number((currentBalMicro - frozenMicro) / MSATS);
    const needSats = Number(totalDebitMicro / MSATS);
    return {
      err: `${errMsg} ⚡️${availSats} / ${needSats}`,
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

  // Transfer house → user balance (or house → pending) in microsats
  const targetAccount = isPending ? pendingId(aid) : balanceId(aid);
  transfers.push({
    id: nextTransferId(),
    debit_account_id: u128(HOUSE_SATS),
    credit_account_id: u128(targetAccount),
    amount: BigInt(amount) * MSATS,
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

  // Add fee credit if applicable - MICROSATS for sub-satoshi precision!
  // e.g., 2% of 10 sats = 0.2 sats = 200,000 microsats (accumulates over time)
  if (creditType && creditLedger[creditType] && config.fee[creditType]) {
    const creditAmountMicro = BigInt(
      Math.round(amount * MSATS_NUM * config.fee[creditType]),
    );
    if (creditAmountMicro > 0n) {
      transfers.push({
        id: nextTransferId(),
        debit_account_id: u128(houseCreditAccount[creditType]),
        credit_account_id: u128(creditId(uid, creditType)),
        amount: creditAmountMicro,
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
  // Transfer pending → balance (via house as intermediary) in microsats
  const linked = TransferFlags.linked;
  const amountMicro = BigInt(amount) * MSATS;

  const transfers = [
    {
      id: nextTransferId(),
      debit_account_id: u128(pendingId(aid)),
      credit_account_id: u128(HOUSE_SATS),
      amount: amountMicro,
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
      amount: amountMicro,
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

  // House → user balance in microsats
  transfers.push({
    id: nextTransferId(),
    debit_account_id: u128(HOUSE_SATS),
    credit_account_id: u128(balanceId(uid)),
    amount: BigInt(total) * MSATS,
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

  // House credit → user credit (lightning) in microsats
  if (creditAmount > 0) {
    transfers.push({
      id: nextTransferId(),
      debit_account_id: u128(HOUSE_LN),
      credit_account_id: u128(creditId(uid, "lightning")),
      amount: BigInt(creditAmount) * MSATS,
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
      amount: BigInt(amount) * MSATS,
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
  // Work entirely in microsats
  const balAcct = await getAccount(balanceId(aid));
  const currentMicro = accountBalanceMicro(balAcct);
  const targetMicro = BigInt(target) * MSATS;
  const diff = targetMicro - currentMicro;
  if (diff === 0n) return;

  const transfers = [
    {
      id: nextTransferId(),
      debit_account_id: diff > 0n ? u128(HOUSE_SATS) : u128(balanceId(aid)),
      credit_account_id: diff > 0n ? u128(balanceId(aid)) : u128(HOUSE_SATS),
      amount: diff > 0n ? diff : -diff,
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
  // Work entirely in microsats
  const pendAcct = await getAccount(pendingId(aid));
  const currentMicro = accountBalanceMicro(pendAcct);
  const targetMicro = BigInt(target) * MSATS;
  const diff = targetMicro - currentMicro;
  if (diff === 0n) return;

  const transfers = [
    {
      id: nextTransferId(),
      debit_account_id: diff > 0n ? u128(HOUSE_SATS) : u128(pendingId(aid)),
      credit_account_id: diff > 0n ? u128(pendingId(aid)) : u128(HOUSE_SATS),
      amount: diff > 0n ? diff : -diff,
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
  // Work entirely in microsats
  const ledger = creditLedger[type];
  if (!ledger) return;

  const creditAcct = await getAccount(creditId(uid, type));
  const currentMicro = accountBalanceMicro(creditAcct);
  const targetMicro = BigInt(target) * MSATS;
  const diff = targetMicro - currentMicro;
  if (diff === 0n) return;

  const transfers = [
    {
      id: nextTransferId(),
      debit_account_id: diff > 0n ? u128(houseCreditAccount[type]) : u128(creditId(uid, type)),
      credit_account_id: diff > 0n ? u128(creditId(uid, type)) : u128(houseCreditAccount[type]),
      amount: diff > 0n ? diff : -diff,
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

export async function createFundAccount(name: string) {
  const accounts = [
    {
      id: u128(fundAccountId(name)),
      ledger: LEDGER_SATS,
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
    },
  ];

  const results = await client.createAccounts(accounts);
  for (const r of results) {
    if (r.result !== CreateAccountError.exists) {
      warn("TB fund account creation:", r.index, r.result);
    }
  }
}

export async function tbFundCredit(name: string, amount: number) {
  await createFundAccount(name);
  const transfers = [
    {
      id: nextTransferId(),
      debit_account_id: u128(HOUSE_SATS),
      credit_account_id: u128(fundAccountId(name)),
      amount: BigInt(amount) * MSATS,
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
    warn("TB fund credit transfer error:", r.index, r.result);
  }
}

export async function tbFundDebit(
  name: string,
  amount: number,
  errMsg: string,
): Promise<any> {
  const transfers = [
    {
      id: nextTransferId(),
      debit_account_id: u128(fundAccountId(name)),
      credit_account_id: u128(HOUSE_SATS),
      amount: BigInt(amount) * MSATS,
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
  if (results.length > 0) {
    const account = await getAccount(fundAccountId(name));
    const bal = accountBalance(account);
    return { err: `${errMsg} ⚡️${bal} / ${amount}` };
  }
  return 0;
}

export async function getFundBalance(name: string): Promise<number | null> {
  const account = await getAccount(fundAccountId(name));
  if (!account) return null;
  return accountBalance(account);
}

// Migration helper: multiply existing balance by MULTIPLIER to convert sats→microsats
// Called by migrateToMicrosats() - adds (balance * 999999) to turn X into X*1000000
// NOTE: This migration should only run ONCE - guarded by tb:microsats flag in migrate.ts
export async function tbMultiplyForMicrosats(uid: string): Promise<number> {
  // Ensure client is initialized (needed when called during startup)
  if (!client) {
    await initTigerBeetle();
  }

  const MULTIPLIER = 999999n; // Adding this turns X into X*1000000
  let count = 0;

  const multiplyAccount = async (
    accountId: bigint,
    ledger: number,
    houseId: bigint,
  ) => {
    const acct = await client.lookupAccounts([u128(accountId)]);
    if (!acct.length) return;
    const current = acct[0].credits_posted - acct[0].debits_posted;
    if (current <= 0n) return;

    const results = await client.createTransfers([
      {
        id: nextTransferId(),
        debit_account_id: u128(houseId),
        credit_account_id: u128(accountId),
        amount: current * MULTIPLIER,
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
    ]);
    if (results.length === 0) count++;
  };

  const balId = balanceId(uid);
  const pendId = pendingId(uid);

  await multiplyAccount(balId, LEDGER_SATS, HOUSE_SATS);
  await multiplyAccount(pendId, LEDGER_SATS, HOUSE_SATS);
  await multiplyAccount(creditId(uid, "bitcoin"), LEDGER_CREDIT_BTC, HOUSE_BTC);
  await multiplyAccount(
    creditId(uid, "lightning"),
    LEDGER_CREDIT_LN,
    HOUSE_LN,
  );
  await multiplyAccount(creditId(uid, "liquid"), LEDGER_CREDIT_LQ, HOUSE_LQ);

  return count;
}
