import { db, g, s } from "$lib/db";
import { findLastUsedIndex, parseDescriptor } from "$lib/esplora";
import { l, warn } from "$lib/logging";
import {
  createBalanceAccount,
  createCreditAccounts,
  tbSetBalance,
  tbSetPending,
  tbSetCredit,
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
  for await (const k of db.scanIterator({ MATCH: "balance:*" })) {
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
  for await (const k of db.scanIterator({ MATCH: "pending:*" })) {
    try {
      const id = k.split(":")[1];
      const pending = Number.parseInt((await db.get(k)) || "0");
      if (pending > 0) await tbSetPending(id, pending);
    } catch (e) {
      warn("failed to migrate pending", k, e.message);
    }
  }

  // Migrate credit:*:* keys
  for await (const k of db.scanIterator({ MATCH: "credit:*:*" })) {
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

export default migrate;
