import { emit } from "$lib/sockets";
import config from "$config";
import { notify } from "$lib/notifications";
import { callWebhook } from "$lib/webhooks";
import ln from "$lib/ln";
import { l, err, warn } from "$lib/logging";
import { g, s, t, db } from "$lib/db";
import Redlock from "redlock";

export async function listenForLightning() {
  let {
    payment_hash: hash,
    bolt11,
    pay_index,
    status,
    msatoshi_received,
    payment_preimage: preimage
  } = await ln.waitanyinvoice(await g("pay_index"));

  await s("pay_index", pay_index);

  let received = Math.round(msatoshi_received / 1000);

  try {
    l("incoming lightning payment", received);

    if (!preimage) return;

    let invoice = await g(`invoice:${hash}`);
    if (!invoice) return warn("received lightning with no invoice", bolt11);

    let { currency, memo, rate, tip, uid } = invoice;
    let amount = parseInt(received) - tip;
    if (amount < 0) throw new Error("amount out of range");

    let user = await g(`user:${uid}`);

    let payment = {
      amount,
      created: Date.now(),
      currency,
      fee: 0,
      hash,
      memo,
      preimage,
      rate,
      tip,
      type: "lightning",
      uid
    };

    invoice.status = "paid";
    invoice.received += received;

    const redlock = new Redlock([db]);

    await s(`invoice:${hash}`, invoice);
    console.log("BAL", await g(`balance:${uid}`));
    setTimeout(async () => {
      let lock = await redlock.acquire(["b"], 5000);
      try {
        let bal = await g(`balance:${uid}`);
        console.log("b bal", bal);
        await new Promise(r => setTimeout(r, 50));

        await s(`balance:${uid}`, bal + 100);
        console.log("set b bal", bal + 100);
      } finally {
        await lock.release();
      }
      // try {
      //   console.log("tweaking balance");
      //   await s(`balance:${uid}`, 0);
      //   await new Promise(r => setTimeout(r, 5));
      //   console.log("mwahaha", await g(`balance:${uid}`));
      //   await new Promise(r => setTimeout(r, 600));
      //   console.log("hmm", await g(`balance:${uid}`));
      // } catch (e) {
      //   console.log(e);
      // }
    }, 50);

    await new Promise(r => setTimeout(r, 5));

    let lock = await redlock.acquire(["a"], 5000);
    try {
      let bal = await g(`balance:${uid}`);
      console.log("a bal", bal, received);
      await new Promise(r => setTimeout(r, 500));

      await s(`balance:${uid}`, bal + received);
      console.log("set a bal", bal + received);
    } finally {
      await lock.release();
    }

    // await t(async signal => {
    //   console.log("acquiring lock");
    //   let bal = await g(`balance:${uid}`);
    //   console.log("bal", bal);
    //   await new Promise(r => setTimeout(r, 500));
    //
    //   if (signal.aborted) throw signal.error;
    //
    //   await s(`balance:${uid}`, bal + received);
    //   console.log("set bal", bal + received);
    // });
    console.log("done", await g(`balance:${uid}`));

    payment.invoice = invoice;

    await s(`payment:${hash}`, payment);
    await db.lpush(`${uid}:payments`, hash);

    callWebhook(invoice, payment);

    emit(uid, "payment", payment);
    notify(user, `Received ${received} SAT`);

    l("lightning payment received", user.username, payment.amount, payment.tip);
  } catch (e) {
    console.log(e);
    err("problem receiving lightning payment", e.message);
  }

  setTimeout(listenForLightning);
}
