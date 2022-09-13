import db from "$db";
import store from "$lib/store";
import { emit } from "$lib/sockets";
import config from "$config";
import { notify } from "$lib/notifications";
import { callWebhook } from "$lib/webhooks";
import { computeConversionFee } from "./conversionFee";
import { sendLiquid } from "$routes/liquid/send";
import { subscribeToInvoices } from "lightning";
import lnd from "$lib/lnd";
import { l, err, warn } from "$lib/logging";

const handlePayment = async msg => {
  try {
    l("incoming lightning payment", msg.received);

    if (!msg.secret) return;
    let account, total, user;

    const invoice = await db.Invoice.findOne({
      where: {
        text: msg.request
      }
    });

    if (!invoice)
      return warn("received lightning with no invoice", msg.request);

    await db.transaction(async transaction => {
      const { text: hash, currency, memo, rate, tip, user_id } = invoice;
      const amount = parseInt(msg.received) - tip;
      if (amount < 0) throw new Error("amount out of range");

      account = await db.Account.findOne({
        where: {
          user_id,
          asset: config.liquid.btcasset,
          pubkey: null
        },
        include: {
          model: db.User,
          as: "user"
        },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      ({ user } = account);

      let preimage = msg.secret;

      let payment = await db.Payment.create(
        {
          account_id: account.id,
          user_id,
          hash,
          memo,
          amount,
          currency,
          preimage,
          rate,
          received: true,
          confirmed: true,
          network: "lightning",
          tip,
          invoice_id: invoice.id
        },
        { transaction }
      );

      total = amount + tip;
      invoice.received += total;

      invoice.status = "paid";
      await invoice.save({ transaction });

      await account.increment({ balance: total }, { transaction });
      // get the # of fee credits you would need to pay off this amount of bitcoin
      await account.increment(
        { lightning_credits: computeConversionFee(total) },
        { transaction }
      );
      await account.reload({ transaction });
      await invoice.save({ transaction });
      await payment.save({ transaction });
      store.payments.push(msg.request);

      payment = payment.get({ plain: true });
      payment.account = account.get({ plain: true });
      payment.invoice = invoice.get({ plain: true });

      callWebhook(invoice, payment);

      emit(user.username, "payment", payment);
      emit(user.username, "account", payment.account);
      notify(user, `Received ${total} SAT`);

      l(
        "lightning payment received",
        user.username,
        payment.amount,
        payment.tip
      );
    });

    let c = store.convert[msg.request];
    if (msg.request && c) {
      l(
        "lightning detected for conversion request",
        msg.request,
        c.address,
        user.username
      );

      user.account = account;

      try {
        sendLiquid({
          address: c.address,
          amount: total - 100,
          user,
          limit: total
        });
      } catch (e) {
        err("problem sending liquid payment", e.message, e.stack);
      }
    }
  } catch (e) {
    console.log(e);
    err("problem receiving lightning payment", e.message);
  }
};

if (config.lna.clightning) {
  const poll = async ln => {
    const wait = async i => {
      const {
        bolt11: payment_request,
        pay_index,
        status,
        msatoshi_received,
        payment_preimage: r_preimage
      } = await ln.waitanyinvoice(i);

      let settled = status === "paid";
      let amt_paid_sat = parseInt(msatoshi_received / 1000);

      await handlePayment({
        payment_request,
        settled,
        amt_paid_sat,
        r_preimage
      });
      wait(pay_index);
    };

    const { invoices } = await ln.listinvoices();
    wait(Math.max(...invoices.map(i => i.pay_index).filter(n => n)));
  };

  poll(ln);
} else {
  const invoices = subscribeToInvoices({ lnd });
  invoices.on("invoice_updated", handlePayment);
}
