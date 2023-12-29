import { types } from "$lib/payments";
import { archive, db, g } from "$lib/db";

let q = {};
async function migrate(id) {
  let user = JSON.parse(await archive.get(`user:${id}`));

  if (typeof user === "string") {
    id = user;
    user = JSON.parse(await archive.get(`user:${id}`));
  }

  if (user) {
    let multi = await db
      .multi()
      .set(`user:${user.username}`, id)
      .set(`user:${user.pubkey}`, id)
      .set(`user:${id}`, JSON.stringify(user))
      .set(`${id}:contacts`, (await archive.get(`${id}:contacts`)) || "[]")
      .set(
        `credit:bitcoin:${id}`,
        (await archive.get(`credit:bitcoin:${id}`)) || 0,
      )
      .set(
        `credit:lightning:${id}`,
        (await archive.get(`credit:lightning:${id}`)) || 0,
      )
      .set(`${id}:lastlen`, (await archive.get(`${id}:lastlen`)) || 0)
      .set(`${id}:cindex`, (await archive.get(`${id}:cindex`)) || 0)
      .set(`balance:${id}`, (await archive.get(`balance:${id}`)) || 0)
      .set(`pending:${id}`, (await archive.get(`pending:${id}`)) || 0);

    let payments = await archive.lRange(`${id}:payments`, 0, -1);
    await Promise.all(
      payments.map(async (pid) => {
        let p = JSON.parse(await archive.get(`payment:${pid}`));
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
        let inv = await archive.get(`invoice:${iid}`);
        multi = await multi
          .lPush(`${id}:invoices`, iid)
          .set(`invoice:${iid}`, inv);
      }),
    );

    await multi.exec();

    delete q[id];
    await migrate(Object.keys(q)[0]);

    return user;
  }
}

export default migrate;
