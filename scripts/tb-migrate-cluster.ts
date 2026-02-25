/**
 * Migrate TigerBeetle from cluster_id 0 to cluster_id 1
 *
 * Steps:
 * 1. Connect to existing TB, dump all account balances
 * 2. Stop TB, rename old data file, create new one with cluster_id 1
 * 3. Start TB, recreate all accounts, replay balances via house transfers
 *
 * Usage: bun scripts/tb-migrate-cluster.ts dump    # step 1: export balances
 *        bun scripts/tb-migrate-cluster.ts restore # step 3: import balances
 */

import { createClient, AccountFlags, CreateAccountError } from "tigerbeetle-node";
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";

const LEDGER_SATS = 1;
const LEDGER_CREDIT_BTC = 2;
const LEDGER_CREDIT_LN = 3;
const LEDGER_CREDIT_LQ = 4;

const HOUSE_SATS = 1n;
const HOUSE_BTC = 2n;
const HOUSE_LN = 3n;
const HOUSE_LQ = 4n;

const MSATS = 1_000_000n;

const creditLedger: Record<string, number> = {
  bitcoin: LEDGER_CREDIT_BTC,
  lightning: LEDGER_CREDIT_LN,
  liquid: LEDGER_CREDIT_LQ,
};

const houseCreditAccount: Record<string, bigint> = {
  bitcoin: HOUSE_BTC,
  lightning: HOUSE_LN,
  liquid: HOUSE_LQ,
};

function uuidToBigInt(uuid: string): bigint {
  return BigInt(`0x${uuid.replace(/-/g, "")}`);
}

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

let transferIdCounter = BigInt(Date.now()) << 64n;
function nextTransferId(): bigint {
  transferIdCounter += 1n;
  return u128(transferIdCounter);
}

// User UUIDs (the real accounts, not aliases)
const USER_UIDS = ["73e3f718-57d1-434c-87e4-e459c80db910", "15cd4878-7f55-4e98-94a5-859744d0499a"];

// Nostr pubkey users (also have accounts derived from their hex)
const NOSTR_UIDS = [
  "3b98c943b27d8c0a456e46d430b26fee7a896c1574638d9e45743418c0c00192",
  "0c3a53c8538b38c98d5bcc53352bd4a55f61eb4710ed8a2d774d5d7f7a97470b",
];

const FUND_NAMES = ["limit"];

const DUMP_FILE = "/home/adam/coinos-server/scripts/tb-dump.json";

interface AccountDump {
  id: string; // bigint as string
  ledger: number;
  code: number;
  flags: number;
  balance_micro: string; // bigint as string
}

async function dump() {
  const client = createClient({ cluster_id: 0n, replica_addresses: ["127.0.0.1:3001"] });
  const accounts: AccountDump[] = [];

  async function lookupAndRecord(id: bigint, ledger: number, flags: number) {
    const results = await client.lookupAccounts([u128(id)]);
    if (results.length > 0) {
      const acct = results[0];
      const balance = acct.credits_posted - acct.debits_posted;
      accounts.push({
        id: u128(id).toString(),
        ledger,
        code: 1,
        flags,
        balance_micro: balance.toString(),
      });
      console.log(`  account ${u128(id)} ledger=${ledger} balance_micro=${balance}`);
    }
  }

  console.log("Dumping house accounts...");
  await lookupAndRecord(HOUSE_SATS, LEDGER_SATS, 0);
  await lookupAndRecord(HOUSE_BTC, LEDGER_CREDIT_BTC, 0);
  await lookupAndRecord(HOUSE_LN, LEDGER_CREDIT_LN, 0);
  await lookupAndRecord(HOUSE_LQ, LEDGER_CREDIT_LQ, 0);

  const allUids = [...USER_UIDS, ...NOSTR_UIDS];

  for (const uid of allUids) {
    console.log(`Dumping user ${uid}...`);
    const constrained = AccountFlags.debits_must_not_exceed_credits;
    await lookupAndRecord(balanceId(uid), LEDGER_SATS, constrained);
    await lookupAndRecord(pendingId(uid), LEDGER_SATS, constrained);
    await lookupAndRecord(creditId(uid, "bitcoin"), LEDGER_CREDIT_BTC, constrained);
    await lookupAndRecord(creditId(uid, "lightning"), LEDGER_CREDIT_LN, constrained);
    await lookupAndRecord(creditId(uid, "liquid"), LEDGER_CREDIT_LQ, constrained);
  }

  for (const name of FUND_NAMES) {
    console.log(`Dumping fund ${name}...`);
    const constrained = AccountFlags.debits_must_not_exceed_credits;
    await lookupAndRecord(fundAccountId(name), LEDGER_SATS, constrained);
  }

  writeFileSync(DUMP_FILE, JSON.stringify(accounts, null, 2));
  console.log(`\nDumped ${accounts.length} accounts to ${DUMP_FILE}`);
  client.destroy();
}

async function restore() {
  const data: AccountDump[] = JSON.parse(readFileSync(DUMP_FILE, "utf-8"));
  console.log(`Restoring ${data.length} accounts to cluster_id 1...`);

  const client = createClient({ cluster_id: 1n, replica_addresses: ["127.0.0.1:3001"] });

  // Create all accounts
  const accountBatch = data.map((a) => ({
    id: BigInt(a.id),
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
    flags: a.flags,
    timestamp: 0n,
  }));

  console.log("Creating accounts...");
  const createResults = await client.createAccounts(accountBatch);
  for (const r of createResults) {
    if (r.result !== CreateAccountError.exists) {
      console.error(`  account creation error: index=${r.index} result=${r.result}`);
    }
  }

  // Replay balances via transfers from/to house accounts
  // House accounts have flags=0 (no constraints), so they can go negative
  console.log("Replaying balances...");
  for (const a of data) {
    const balMicro = BigInt(a.balance_micro);
    if (balMicro === 0n) continue;

    // Skip house accounts (they'll get their balances from the user transfers)
    const id = BigInt(a.id);
    if (
      id === u128(HOUSE_SATS) ||
      id === u128(HOUSE_BTC) ||
      id === u128(HOUSE_LN) ||
      id === u128(HOUSE_LQ)
    ) {
      continue;
    }

    // Determine the house account for this ledger
    const houseId =
      a.ledger === LEDGER_SATS
        ? HOUSE_SATS
        : a.ledger === LEDGER_CREDIT_BTC
          ? HOUSE_BTC
          : a.ledger === LEDGER_CREDIT_LN
            ? HOUSE_LN
            : HOUSE_LQ;

    if (balMicro > 0n) {
      // Positive balance: house → user
      const results = await client.createTransfers([
        {
          id: nextTransferId(),
          debit_account_id: u128(houseId),
          credit_account_id: id,
          amount: balMicro,
          pending_id: 0n,
          user_data_128: 0n,
          user_data_64: 0n,
          user_data_32: 0,
          timeout: 0,
          ledger: a.ledger,
          code: 1,
          flags: 0,
          timestamp: 0n,
        },
      ]);
      if (results.length > 0) {
        console.error(`  transfer error for account ${id}: ${results[0].result}`);
      } else {
        console.log(`  restored account ${id} balance=${balMicro}`);
      }
    }
  }

  // Verify house balances
  console.log("\nVerifying house account balances...");
  for (const [name, houseId] of [
    ["SATS", HOUSE_SATS],
    ["BTC", HOUSE_BTC],
    ["LN", HOUSE_LN],
    ["LQ", HOUSE_LQ],
  ] as const) {
    const results = await client.lookupAccounts([u128(houseId)]);
    if (results.length > 0) {
      const bal = results[0].credits_posted - results[0].debits_posted;
      console.log(`  HOUSE_${name}: balance_micro=${bal} (${Number(bal / MSATS)} sats)`);
    }
  }

  console.log("\nDone!");
  client.destroy();
}

const cmd = process.argv[2];
if (cmd === "dump") {
  await dump();
} else if (cmd === "restore") {
  await restore();
} else {
  console.log("Usage: bun scripts/tb-migrate-cluster.ts [dump|restore]");
}
