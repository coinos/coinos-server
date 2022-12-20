import config from "$config";
import db from "$db";
import { emit } from "$lib/sockets";
import store from "./store";
import bolt11 from "bolt11";
import { Op } from "@sequelize/core";
import {
  computeConversionFee,
  conversionFeeReceiver
} from "../routes/lightning/conversionFee";
import ln from "$lib/ln";
import { l, warn, err } from "$lib/logging";

export default async (amount, memo, hash, user) => {
  l("attempting lightning payment", user.username, amount, hash);

  let payreq = bolt11.decode(hash);
  let routingInfo = payreq.tags.find(t => t.tagName === "routing_info");
  if (
    routingInfo &&
    routingInfo.data.find(d => d.fee_proportional_millionths > 10000)
  ) {
    warn("fee rate too high", routingInfo);
    throw new Error(
      "Couldn't find a suitable route to pay to your destination"
    );
  }

  if (!amount || payreq.satoshis > amount) amount = payreq.satoshis;
  amount = parseInt(amount);

  if (store.seen.includes(hash)) {
    warn("attempted to pay a paid invoice", user.username);
    throw new Error("Invoice has been paid, can't pay again");
  }

  let error, fee, total, preimage, payment;

  let conversionFee = computeConversionFee(amount);
  let conversionFeeDeduction;
  await db.transaction(async transaction => {
    l("starting lightning send transaction");
    let account;
    if (user.account.asset === config.liquid.btcasset)
      account = await db.Account.findOne({
        where: {
          id: user.account.id,
          pubkey: null
        },
        lock: transaction.LOCK.UPDATE,
        transaction
      });
    else
      account = await db.Account.findOne({
        where: {
          user_id: user.id,
          asset: config.liquid.btcasset,
          pubkey: null,
          balance: {
            [Op.gte]: amount
          }
        },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

    conversionFeeDeduction = Math.min(account.lightning_credits, conversionFee);
    total = amount + conversionFee - conversionFeeDeduction;

    if (!account || account.balance < total) {
      warn(
        "user attempting to send more than they have",
        user.id,
        amount,
        conversionFee
      );
      throw new Error("Insufficient funds");
    }

    await account.decrement(
      { balance: total, lightning_credits: conversionFeeDeduction },
      { transaction }
    );
    await account.reload({ transaction });

    l("debited account", account.id, total);
    let tokens;
    if (!payreq.satoshis) tokens = amount;

    let m;
    let { msatoshi, msatoshi_sent, payment_preimage } = await ln.pay(
      hash,
      tokens ? `${tokens}sats` : undefined
    );
    preimage = payment_preimage;
    fee = parseInt((msatoshi_sent - msatoshi) / 1000);

    if (store.seen.includes(preimage)) {
      warn("duplicate payment detected", preimage);
      throw new Error("Duplicate payment detected");
    }

    store.seen.push(preimage);
    store.seen.push(hash);
  });

  await db.transaction(async transaction => {
    l("starting lightning fee transaction");

    let account;
    if (user.account.asset === config.liquid.btcasset)
      account = await db.Account.findOne({
        where: {
          id: user.account.id,
          pubkey: null
        },
        lock: transaction.LOCK.UPDATE,
        transaction
      });
    else
      account = await db.Account.findOne({
        where: {
          user_id: user.id,
          asset: config.liquid.btcasset,
          pubkey: null,
          balance: {
            [Op.gte]: fee
          }
        },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

    l("deducting fee", fee);
    await account.decrement({ balance: fee }, { transaction });
    await account.reload({ transaction });

    if (conversionFeeDeduction) {
      conversionFee -= conversionFeeDeduction;
    }

    l("conversion fee", conversionFee);

    let receiverAccount = await db.Account.findOne({
      where: {
        "$user.username$": conversionFeeReceiver
      },
      include: [
        {
          model: db.User,
          as: "user"
        }
      ],
      lock: transaction.LOCK.UPDATE,
      transaction
    });

    let fee_payment;
    let fee_payment_id = null;
    if (conversionFee) {
      await receiverAccount.increment(
        { balance: conversionFee },
        { transaction }
      );
      await receiverAccount.reload({ transaction });
      fee_payment = await db.Payment.create(
        {
          amount: conversionFee,
          fee: 0,
          memo: "Lightning conversion fee",
          account_id: receiverAccount.id,
          user_id: receiverAccount.user_id,
          rate: store.rates[receiverAccount.user.currency],
          currency: receiverAccount.user.currency,
          confirmed: true,
          received: true,
          network: "COINOS"
        },
        { transaction }
      );
      fee_payment_id = fee_payment.id;
    }

    payment = await db.Payment.create(
      {
        amount: -total,
        account_id: account.id,
        user_id: user.id,
        hash,
        memo,
        preimage,
        rate: store.rates[user.currency],
        currency: user.currency,
        confirmed: true,
        network: "lightning",
        fee,
        fee_payment_id
      },
      { transaction }
    );

    l("created payment record", payment.id);

    payment = payment.get({ plain: true });
    payment.account = account.get({ plain: true });
    payment.fee_payment = fee_payment && fee_payment.get({ plain: true });

    emit(user.username, "account", payment.account);
    emit(user.username, "payment", payment);

    l("sent lightning", user.username, amount, total, fee);
  });

  return payment;
};
