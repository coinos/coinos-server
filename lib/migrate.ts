import { db, g, s } from "$lib/db";
import { findLastUsedIndex, parseDescriptor } from "$lib/esplora";
import { warn } from "$lib/logging";

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

export default migrate;
