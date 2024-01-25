import { err, warn, l, line } from "$lib/logging";
import { types } from "$lib/payments";
import { archive, db, g, ga, s } from "$lib/db";
import { wait } from "$lib/utils";

let queued = {};
let migrating = {};
async function migrate(id) {
  if (id) id = id.replace(/\s/g, "").toLowerCase();

  let user = await g(`user:${id}`);
  if (typeof user === "string") user = await g(`user:${user}`);
  if (user) {
    delete migrating[id];
    return user;
  }

  user = await ga(`user:${id}`);

  if (typeof user === "string") {
    if (await g(`user:${user}`)) {
      warn("user already migrated", id);
      s(`user:${id}`, user);
    }

    id = user;
    user = await ga(`user:${id}`);
  }

  if (user) {
    if (migrating[id]) return;
    migrating[id] = true;

    let { username } = user;
    username = username.replace(/\s/g, "").toLowerCase();
    l("migrating", username);

    try {
      let multi = await db
        .multi()
        .set(`user:${username}`, id)
        .set(`user:${user.pubkey}`, id)
        .set(`user:${id}`, JSON.stringify(user));

      await multi.exec();

      await archive.del(`user:${username}`);
      await archive.del(`user:${user.pubkey}`);
      await archive.del(`user:${id}`);

      await s(`${id}:contacts`, (await ga(`${id}:contacts`)) || []);
      await archive.del(`${id}:contacts`);

      await s(`credit:bitcoin:${id}`, (await ga(`credit:bitcoin:${id}`)) || 0);
      await archive.del(`credit:bitcoin:${id}`);

      await s(
        `credit:lightning:${id}`,
        (await ga(`credit:lightning:${id}`)) || 0,
      );
      await archive.del(`credit:lightning:${id}`);

      await s(`${id}:lastlen`, (await ga(`${id}:lastlen`)) || 0);
      await archive.del(`${id}:lastlen`);
      await s(`${id}:cindex`, (await ga(`${id}:cindex`)) || 0);
      await archive.del(`${id}:cindex`);
      await s(`balance:${id}`, (await ga(`balance:${id}`)) || 0);
      await archive.del(`balance:${id}`);
      await s(`pending:${id}`, (await ga(`pending:${id}`)) || 0);
      await archive.del(`pending:${id}`);

      let pid;
      while ((pid = await archive.rPop(`${id}:payments`))) {
        let p = await ga(`payment:${pid}`);
        if (!p) continue;
        if (p.type === types.internal && p.ref) {
          let recipient = await g(`user:${p.ref}`);
          if (!recipient) queued[p.ref] = true;
        }

        await multi
          .lPush(`${id}:payments`, pid)
          .set(`payment:${pid}`, JSON.stringify(p))
          .exec();

        await archive.del(`payment:${pid}`);
      }
      await archive.del(`${id}:payments`);

      let iid;
      while ((iid = await archive.rPop(`${id}:invoices`))) {
        let inv = await ga(`invoice:${iid}`);
        if (!inv) continue;
        await multi
          .lPush(`${id}:invoices`, iid)
          .set(`invoice:${iid}`, JSON.stringify(inv))
          .exec();

        await archive.del(`invoice:${iid}`);
      }
      await archive.del(`${id}:invoices`);

      l("done migrating", username);
    } catch (e) {
      warn("failed to migrate", username, e.message, line());
    }

    delete migrating[id];
    return user;
  }
}

let keepMigrating = async () => {
  try {
    if (Object.keys(queued).length) {
      await migrate(Object.keys(queued)[0]);
    }
  } catch (e) {
    err("problem migrating", e.message);
  }

  setTimeout(keepMigrating, 1000);
};

keepMigrating();

export default migrate;
