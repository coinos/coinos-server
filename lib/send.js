const bolt11 = require("bolt11");
const { Op } = require("sequelize");

send = async (amount, memo, hash, user) => {
  l.info("attempting lightning payment", user.username, amount, hash);

  let payreq = bolt11.decode(hash);
  let routingInfo = payreq.tags.find(t => t.tagName === "routing_info");
  if (
    routingInfo &&
    routingInfo.data.find(d => d.fee_proportional_millionths > 10000)
  ) {
    l.warn("fee rate too high", d.fee_proportional_millionths);
    throw new Error("Couldn't find a suitable route to pay to your destination");
  }

  if (!amount || payreq.satoshis > amount) amount = payreq.satoshis;

  if (seen.includes(hash)) {
    l.warn("attempted to pay a paid invoice", user.username);
    throw new Error("Invoice has been paid, can't pay again");
  }

  let error, fee, total, preimage, payment;

  await db.transaction(async transaction => {
    let account;
    if (user.account.asset === config.liquid.btcasset)
      account = await db.Account.findOne({
        where: {
          id: user.account.id,
          pubkey: null,
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

    if (!account || account.balance < amount) {
      throw new Error("Insufficient funds");
    }

    await account.decrement({ balance: amount }, { transaction });
    await account.reload({ transaction });

    l.info("debited account", account.id);

    if (config.lna.clightning) {
      let m = await lna.pay(hash);
      let sent;
      ({
        msatoshi: total,
        msatoshi_sent: sent,
        payment_preimage: preimage
      } = m);

      fee = parseInt((sent - total) / 1000);
      total = parseInt(total / 1000);
    } else {
      let m = await lnp.sendPaymentSync({
        amt: amount,
        payment_request: hash,
        max_parts: 10,
        fee_limit: { fixed: Math.min(10000, account.balance) }
      });

      if (!m) throw new Error(`lightning payment failed ${amount} ${hash}`);
      if (m.payment_error) throw new Error(m.payment_error);

      ({
        payment_route: { total_fees: fee, total_amt: total },
        payment_preimage: preimage
      } = m);
    }

    preimage = preimage.toString("hex");

    if (seen.includes(preimage)) {
      l.warn("duplicate payment detected", preimage);
      throw new Error("Duplicate payment detected");
    }
  });

  await db.transaction(async transaction => {
    let account;
    if (user.account.asset === config.liquid.btcasset)
      account = await db.Account.findOne({
        where: {
          id: user.account.id,
          pubkey: null,
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

    total = parseInt(total);
    fee = parseInt(fee);

    await account.decrement({ balance: fee }, { transaction });
    await account.reload({ transaction });

    payment = await db.Payment.create(
      {
        amount: -(total - fee),
        account_id: account.id,
        user_id: user.id,
        hash,
        memo,
        preimage,
        rate: app.get("rates")[user.currency],
        currency: user.currency,
        confirmed: true,
        network: "lightning",
        fee
      },
      { transaction }
    );

    l.info("created payment record", payment.id);

    payment = payment.get({ plain: true });
    payment.account = account.get({ plain: true });

    emit(user.username, "account", payment.account);
    emit(user.username, "payment", payment);

    seen.push(preimage);
    seen.push(hash);

    l.info("sent lightning", user.username, total - fee, fee);
  });

  return payment;
};
