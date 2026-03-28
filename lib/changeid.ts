import { db, g, s, ga, sa, archive as arc } from "$lib/db";
import { err, l } from "$lib/logging";
import { randomUUID } from "crypto";

export default async function changeid(un: string) {
  un = un.toLowerCase();
  const id = await g(`user:${un}`);
  if (!id) throw new Error(`user ${un} not found`);

  l(`SECURITY: rekeying ${un}, old id ${id}`);

  const nid = randomUUID();
  const user = await g(`user:${id}`);
  if (!user) throw new Error(`user record ${id} not found`);

  user.id = nid;
  user.password = "reset";

  if (user.pubkey) {
    await s(user.pubkey, nid);
    await sa(user.pubkey, nid);
  }
  await s(`user:${un}`, nid);
  await sa(`user:${un}`, nid);
  await s(`user:${nid}`, user);
  await sa(`user:${nid}`, user);

  const keys = [
    `credit:lightning:${id}`,
    `credit:liquid:${id}`,
    `${id}:invoices`,
    `credit:bitcoin:${id}`,
    `pending:${id}`,
    `${id}:lastlen`,
    `${id}:contacts`,
    `${id}:accounts`,
    `${id}:payments`,
    `account:${id}`,
    `balance:${id}`,
    `user:${id}`,
  ];

  async function migrateKeys(client, get, set, label) {
    for (const k of keys) {
      const nk = k.replace(id, nid);
      try {
        if (
          k.includes("credit:") ||
          k.includes("balance:") ||
          k.includes("pending:")
        ) {
          const a = await get(k);
          await client.incrBy(nk, parseInt(a) || 0);
          await client.del(k);
        } else if (k.includes(":invoices") || k.includes(":payments")) {
          const arr = await client.lRange(k, 0, -1);
          const narr = [];
          for (const pid of arr) {
            const ok = `${k.split(":")[1].slice(0, -1)}:${pid}`;
            const o = await get(ok);
            if (!o) continue;
            o.id = pid;
            o.uid = nid;
            if (o.aid === id) o.aid = nid;
            await set(ok, o);
            narr.push(o);
          }

          await client.del(k);

          for (const o of narr.sort((a, b) => b?.created - a?.created)) {
            if (o) await client.rPush(nk, o.id);
          }
        } else if (k.includes("account:")) {
          const acc = await get(k);
          if (!acc) continue;
          acc.id = nid;
          await set(nk, acc);
          await client.del(k);
        } else if (k.includes("user:")) {
          await client.del(k);
        } else {
          await client.rename(k, nk);
        }
      } catch (e: any) {
        err(`changeid [${label}]`, k, e.message);
      }
    }

    await client.lRem(`${nid}:accounts`, 0, id);
    await client.rPush(`${nid}:accounts`, nid);
  }

  await migrateKeys(db, g, s, "main");
  await migrateKeys(arc, ga, sa, "arc");

  const apps = await db.sMembers(`${id}:apps`);
  for (const aid of apps) {
    await db.del(`app:${aid}`);
  }
  await db.del(`${id}:apps`);

  // Update invoices that reference the old uid
  for await (const k of db.scanIterator({ MATCH: "invoice:*" })) {
    try {
      const inv = await g(k);
      if (!inv || typeof inv === "string") continue;
      let changed = false;
      if (inv.uid === id) { inv.uid = nid; changed = true; }
      if (inv.aid === id) { inv.aid = nid; changed = true; }
      if (changed) {
        await s(k, inv);
        l("changeid: updated invoice", k);
      }
    } catch (e) {}
  }

  l(`SECURITY: rekeyed ${un} from ${id} to ${nid}`);
  return nid;
}
