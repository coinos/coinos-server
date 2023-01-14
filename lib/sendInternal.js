import config from "$config";
import { emit } from "$lib/sockets";
import store from "$lib/store";
import { callWebhook } from "$lib/webhooks";
import { v4 } from "uuid";
import { notify } from "$lib/notifications";
import { l, err } from "$lib/logging";
import { fail } from "$lib/utils";
import ln from "$lib/ln";
import { g, s, rd } from "$lib/redis";

const { HOSTNAME: hostname } = process.env;

export default async (
  { amount, address, payreq, unconfidential, memo, username, tip },
  user
) => {
  amount = parseInt(amount);

  if (!amount || amount < 0) fail("Amount must be greater than zero");

  let fee = 0;
  let recipient;

  let t = async () => {
    await rd.watch(`user:${user_id}`);
    user = await g(`user:${user_id}`);
    if (user.balance < amount) throw new Error("Insufficient funds");

    user.balance -= amount;
    let m = await rd.multi();
    await s(`user:${user.id}`, user);

    if (username && (recipient = await g(`user:${username}`))) {
      let { payment_hash: h } = await ln.decode(payreq);
      let invoice = payreq && (await g(`invoice:${h}`));

      let t = async () => {
        await rd.watch(`user:${recipient.id}`);
        recipient = await g(`user:${recipient.id}`);
        recipient.balance += amount;
        let m = await rd.multi();
        await s(`user:${recipient.id}`, recipient);
        if (!(await m.exec())) t();
      };
      await t();

      if (!(await m.exec())) t();
    }
    await t();

    let p2 = {
      id: v4(),
      amount,
      user_id: recipient.id,
      rate: store.rates[recipient.currency],
      currency: recipient.currency,
      memo,
      type: "internal",
      with_id: user.id,
      created_at: Date.now()
    };

    if (invoice) {
      let { tip } = invoice;
      params.invoice_id = invoice.id;
      if (tip) {
        params.tip = tip;
        params.amount -= tip;
      }

      invoice.received += amount;
      await s(`invoice:${h}`, invoice);
    }

    if (invoice) p2.invoice = invoice;
    await s(`payment:${p2.id}`, p2);
    await rd.lPush(`${recipient.id}:payments`, p2.id);

    emit(recipient.username, "payment", p2);

    l("received internal", recipient.username, amount);
    notify(recipient, `Received ${amount} sats`);
    callWebhook(invoice, p2);
  };

  let p1 = {
    id: v4(),
    amount: -amount,
    memo,
    user_id: user.id,
    rate: store.rates[user.currency],
    currency: user.currency,
    with_id: recipient && recipient.id,
    hash: `#${v4().substr(0, 6)} ${
      username ? `Payment to ${username}` : "Internal Transfer"
    }`,
    type: "internal",
    created_at: Date.now()
  };

  if (!username) {
    l("creating redeemable payment");
    params.redeemcode = v4();
    params.hash = `${hostname}/redeem/${params.redeemcode}`;
  }

  await s(`payment:${p1.id}`, p1);
  await rd.lPush(`${user.id}:payments`, p1.id);

  l("sent internal", user.username, -p1.amount);

  emit(user.username, "payment", p1);

  return p1;
};
