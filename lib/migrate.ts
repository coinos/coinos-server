import { db, g, s, scan } from "$lib/db";
import { findLastUsedIndex, parseDescriptor } from "$lib/esplora";
import { l, warn } from "$lib/logging";
import {
  createBalanceAccount,
  createCreditAccounts,
  createFundAccount,
  tbFundCredit,
  tbSetBalance,
  tbSetPending,
  tbSetCredit,
  tbMultiplyForMicrosats,
} from "$lib/tb";

async function migrate(id) {
  const k = id?.replace(/\s/g, "").toLowerCase();
  let user = await g(`user:${k}`);
  if (typeof user === "string") user = await g(`user:${user}`);
  return user;
}

export const migrateAccounts = async () => {
  const keys = await db.keys("account:*");
  let migrated = 0;

  for (const key of keys) {
    try {
      if (key.endsWith(":invoices")) continue;
      const keyType = await db.type(key);
      if (keyType !== "string") continue;

      const account = await g(key);
      if (!account || !account.id) continue;
      if (account.pubkey || account.type === "ark" || !account.seed) continue;
      if (!account.descriptors?.length) continue;

      const parsed = parseDescriptor(account.descriptors[0].desc);
      if (!parsed) continue;

      account.pubkey = parsed.pubkey;
      account.fingerprint = parsed.fingerprint;
      try {
        account.nextIndex = await findLastUsedIndex(
          parsed.pubkey,
          parsed.fingerprint,
        );
      } catch (e) {
        warn("account migration index scan skipped", key, e.message);
        account.nextIndex = account.nextIndex || 0;
      }

      await s(`account:${account.id}`, account);
      migrated++;
    } catch (e) {
      warn("failed to migrate account", key, e.message);
    }
  }

  return migrated;
};

export const migrateBalancesToTB = async () => {
  const migrated = await db.get("tb:migrated");
  if (migrated) return 0;

  let count = 0;

  // Migrate balance:* keys
  for await (const k of scan("balance:*")) {
    try {
      const id = k.split(":")[1];
      const balance = Number.parseInt((await db.get(k)) || "0");
      await createBalanceAccount(id);
      if (balance > 0) await tbSetBalance(id, balance);
      count++;
    } catch (e) {
      warn("failed to migrate balance", k, e.message);
    }
  }

  // Migrate pending:* keys
  for await (const k of scan("pending:*")) {
    try {
      const id = k.split(":")[1];
      const pending = Number.parseInt((await db.get(k)) || "0");
      if (pending > 0) await tbSetPending(id, pending);
    } catch (e) {
      warn("failed to migrate pending", k, e.message);
    }
  }

  // Migrate credit:*:* keys
  for await (const k of scan("credit:*:*")) {
    try {
      const parts = k.split(":");
      const type = parts[1];
      const uid = parts[2];
      const amount = Number.parseInt((await db.get(k)) || "0");
      await createCreditAccounts(uid);
      if (amount > 0) await tbSetCredit(uid, type, amount);
    } catch (e) {
      warn("failed to migrate credit", k, e.message);
    }
  }

  await db.set("tb:migrated", Date.now().toString());
  l(`Migrated ${count} balances to TigerBeetle`);
  return count;
};

export const migrateToMicrosats = async () => {
  const migrated = await db.get("tb:microsats");
  if (migrated) return 0;

  let count = 0;

  // Iterate through all users and multiply their TB balances
  for await (const k of scan("user:*")) {
    try {
      const raw = await db.get(k);
      if (!raw) continue;

      // Skip user alias keys (they just contain another key reference)
      if (!raw.startsWith("{")) continue;

      const user = JSON.parse(raw);
      if (!user.id) continue;

      const multiplied = await tbMultiplyForMicrosats(user.id);
      if (multiplied > 0) count++;
    } catch (e) {
      warn("microsats migration error", k, e.message);
    }
  }

  await db.set("tb:microsats", Date.now().toString());
  l(`Migrated ${count} users to microsats`);
  return count;
};

export const migrateAutowithdraw = async () => {
  const migrated = await db.get("autowithdraw:migrated");
  if (migrated) return 0;

  let count = 0;

  for await (const k of scan("user:*")) {
    try {
      const raw = await db.get(k);
      if (!raw || !raw.startsWith("{")) continue;

      const user = JSON.parse(raw);
      if (!user.id || !user.autowithdraw) continue;

      const accountIds = await db.lRange(`${user.id}:accounts`, 0, -1);

      for (const aid of accountIds) {
        const account = await g(`account:${aid}`);
        if (!account) continue;
        if (account.seed || account.type === "ark") continue;
        if (account.autowithdraw) continue;

        account.autowithdraw = true;
        account.threshold = account.threshold ?? user.threshold;
        account.reserve = account.reserve ?? user.reserve;
        account.destination = account.destination ?? user.destination;

        await s(`account:${aid}`, account);
        count++;
      }
    } catch (e) {
      warn("autowithdraw migration error", k, e.message);
    }
  }

  await db.set("autowithdraw:migrated", Date.now().toString());
  l(`Migrated autowithdraw to ${count} accounts`);
  return count;
};

export const migrateFundsToTB = async () => {
  const migrated = await db.get("tb:funds-migrated");
  if (migrated) return 0;

  let count = 0;

  for await (const k of scan("fund:*")) {
    try {
      // Skip sub-keys like fund:name:payments, fund:name:managers, fund:limit
      const parts = k.split(":");
      if (parts.length !== 2) continue;
      const name = parts[1];
      if (name === "limit") continue;

      const keyType = await db.type(k);
      if (keyType !== "string") continue;

      const balance = Number.parseInt((await db.get(k)) || "0");
      await createFundAccount(name);
      if (balance > 0) await tbFundCredit(name, balance);
      count++;
    } catch (e) {
      warn("failed to migrate fund", k, e.message);
    }
  }

  await db.set("tb:funds-migrated", Date.now().toString());
  l(`Migrated ${count} funds to TigerBeetle`);
  return count;
};

export default migrate;
