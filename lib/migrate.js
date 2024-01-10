import { err, warn, l } from "$lib/logging";
import { types } from "$lib/payments";
import { archive, db, g, ga } from "$lib/db";

let q = {};
async function migrate(id) {
  id = id.replace(/\s/g, "").toLowerCase();
  let user = await ga(`user:${id}`);

  if (typeof user === "string") {
    if (await g(`user:${user}`)) {
      warn("user already migrated", id);
      s(`user:${id}`, user);
    }

    id = user;

    user = await ga(`user:${id}`);
  }

  if (user) {
    let { username } = user;
    username = username.replace(/\s/g, "").toLowerCase();
    l("migrating", username);
    let multi = await db
      .multi()
      .set(`user:${username}`, id)
      .set(`user:${user.pubkey}`, id)
      .set(`user:${id}`, JSON.stringify(user))
      .set(`${id}:contacts`, (await ga(`${id}:contacts`)) || "[]")
      .set(`credit:bitcoin:${id}`, (await ga(`credit:bitcoin:${id}`)) || 0)
      .set(`credit:lightning:${id}`, (await ga(`credit:lightning:${id}`)) || 0)
      .set(`${id}:lastlen`, (await ga(`${id}:lastlen`)) || 0)
      .set(`${id}:cindex`, (await ga(`${id}:cindex`)) || 0)
      .set(`balance:${id}`, (await ga(`balance:${id}`)) || 0)
      .set(`pending:${id}`, (await ga(`pending:${id}`)) || 0);

    let payments = await archive.lRange(`${id}:payments`, 0, -1);
    await Promise.all(
      payments.map(async (pid) => {
        let p = await ga(`payment:${pid}`);
        if (p.type === types.internal && p.ref) {
          let recipient = await g(`user:${p.ref}`);
          if (!recipient) q[p.ref] = true;
        }

        multi = await multi
          .lPush(`${id}:payments`, pid)
          .set(`payment:${pid}`, JSON.stringify(p));
      }),
    );

    let invoices = await archive.lRange(`${id}:invoices`, 0, -1);
    await Promise.all(
      invoices.map(async (iid) => {
        let inv = await ga(`invoice:${iid}`);
        multi = await multi
          .lPush(`${id}:invoices`, iid)
          .set(`invoice:${iid}`, JSON.stringify(inv));
      }),
    );

    try {
      await multi.exec();
    } catch (e) {
      warn("failed to migrate", username);
    }

    delete q[id];

    return user;
  }
}

let keepMigrating = async () => {
  try {
    if (Object.keys(q).length) {
      await migrate(Object.keys(q)[0]);
    }
  } catch (e) {
    err("problem migrating", e.message);
  }

  setTimeout(keepMigrating, 100);
};

keepMigrating();

export default migrate;
