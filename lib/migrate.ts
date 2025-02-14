import { archive, db, g, ga, s } from "$lib/db";
import { err, l, line, warn } from "$lib/logging";
import { types } from "$lib/payments";

const queued = {};
const migrating = {};

async function migrate(id) {
  try {
    delete queued[id];
    if (id) id = id.replace(/\s/g, "").toLowerCase();

    let user = await g(`user:${id}`);
    if (typeof user === "string") user = await g(`user:${user}`);
    return user;

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
        const multi = await db
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

        await s(
          `credit:bitcoin:${id}`,
          (await ga(`credit:bitcoin:${id}`)) || 0,
        );
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
          const p = await ga(`payment:${pid}`);
          const pos = await db.lPos(`${id}:payments`, pid);
          if (!p || pos) continue;
          if (p.type === types.internal && p.ref) {
            const recipient = await g(`user:${p.ref}`);
            if (!recipient) queued[p.ref] = true;
          }

          await db.lPush(`${id}:payments`, pid);
          await s(`payment:${pid}`, p);

          await archive.del(`payment:${pid}`);
        }
        await archive.del(`${id}:payments`);

        let iid;
        while ((iid = await archive.rPop(`${id}:invoices`))) {
          const inv = await ga(`invoice:${iid}`);
          const pos = await db.lPos(`${id}:invoices`, iid);
          if (!inv || pos) continue;
          await db.lPush(`${id}:invoices`, iid);
          await s(`invoice:${iid}`, inv);

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
  } catch (e) {
    delete migrating[id];
    throw e;
  }
}

const keepMigrating = async () => {
  try {
    if (Object.keys(queued).length) {
      const next = Object.keys(queued)[0];
      await migrate(next);
    }
  } catch (e) {
    err("problem migrating", e.message);
  }

  setTimeout(keepMigrating, 1000);
};

keepMigrating();

export default migrate;
