import config from "$config";
import { emit } from "$lib/sockets";
import store from "$lib/store";
import { callWebhook } from "$lib/webhooks";
import { v4 } from "uuid";
import { notify } from "$lib/notifications";
import { l, err } from "$lib/logging";
import { fail } from "$lib/utils";
import ln from "$lib/ln";
import { g, s, db } from "$lib/db";

const { HOSTNAME: hostname } = process.env;

export default async (
  { amount, hash, memo, tip },
  user
) => {
  amount = parseInt(amount);

  if (!amount || amount < 0) fail("Amount must be greater than zero");

  let fee = 0;
  let invoice = await g(`invoice:${hash}`);

  let t = async () => {
    await db.watch(`user:${user.id}`);
    user = await g(`user:${user.id}`);
    if (user.balance < amount) fail("Insufficient funds");
    user.balance -= amount;
    let m = await db.multi();
    await s(`user:${user.id}`, user);

    let p1 = {
      hash,
      amount: -amount,
      memo,
      uid: user.id,
      rate: store.rates[user.currency],
      currency: user.currency,
      type: "internal",
      created: Date.now()
    };

    await s(`payment:${hash}`, p1);
    await db.lPush(`${user.id}:payments`, hash);

    l("sent internal", user.username, -p1.amount);
    emit(user.id, "payment", p1);

    let { uid } = invoice;
    if (uid !== user.id) {
      let recipient = await g(`user:${uid}`);

      let u = async () => {
        await db.watch(`user:${uid}`);
        recipient = await g(`user:${uid}`);
        recipient.balance += amount;
        let m = await db.multi();
        await s(`user:${uid}`, recipient);
        if (!(await m.exec())) u();
      };
      await u();

      let p2 = {
        hash,
        amount,
        uid: recipient.id,
        rate: store.rates[recipient.currency],
        currency: recipient.currency,
        memo,
        type: "internal",
        with_id: user.id,
        created: Date.now()
      };

      let { tip } = invoice;
      if (tip) {
        p2.tip = tip;
        p2.amount -= tip;
      }

      invoice.received += amount;
      await s(`invoice:${hash}`, invoice);
      await s(`payment:${id}`, p2);
      await db.lPush(`${recipient.id}:payments`, id);

      l("received internal", recipient.username, amount);
      emit(recipient.username, "payment", p2);
      notify(recipient, `Received ${amount} sats`);
      callWebhook(invoice, p2);
    }

    if (!(await m.exec())) t();
  };
  await t();
};
