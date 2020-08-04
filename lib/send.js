const bolt11 = require("bolt11");

send = async (amount, memo, hash, user) => {
  let payreq = bolt11.decode(hash);

  if (!amount) amount = payreq.satoshis;

  l.info("attempting lightning payment", hash, user.username, amount);

  if (seen.includes(hash)) {
    l.warn("attempted to pay a paid invoice", user.username);
    throw new Error("Invoice has been paid, can't pay again");
  }

  let payment;

    await db.transaction(async (transaction) => {
      let account = await db.Account.findOne({
        where: {
          user_id: user.id,
          asset: config.liquid.btcasset,
        },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });

      if (account.balance < amount) {
        throw new Error("Insufficient funds");
      }

      let error, fee, total, preimage;

      if (config.lna.clightning) {
        let m = await lna.pay(hash);
        let sent;
        ({
          msatoshi: total,
          msatoshi_sent: sent,
          payment_preimage: preimage,
        } = m);

        fee = parseInt((sent - total) / 1000);
        total = parseInt(total / 1000);
      } else {
        let m = await lna.sendPaymentSync({
          amt: amount,
          payment_request: hash,
          max_parts: 10,
        });

        if (m.payment_error) throw new Error(m.payment_error);

        ({
          payment_route: { total_fees: fee, total_amt: total },
          payment_preimage: preimage,
        } = m);
      }

      preimage = preimage.toString("hex");

      if (payreq.payeeNodeKey === config.lnb.id) {
        if (config.lna.clightning) {
          let invoice = await lna.invoice(
            `${amount}sat` || "any",
            new Date(),
            "",
            360
          );
          let { bolt11: payment_request } = invoice;
          await lnb.pay(payment_request);
        } else {
          let invoice = await lna.addInvoice({ value: amount });
          let { payment_request } = invoice;
          await lnb.sendPaymentSync({ payment_request, max_parts: 10 });
        }
        l.info("lnb sent back", amount);
      }

      if (seen.includes(preimage)) {
        l.warn("duplicate payment detected", preimage);
        throw new Error("Duplicate payment detected");
      }

      total = parseInt(total);
      fee = parseInt(fee);

      account.balance -= total;
      await account.save({ transaction });

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
          network: "LNBTC",
          fee,
        },
        { transaction }
      );

      payment = payment.get({ plain: true });
      payment.account = account.get({ plain: true });

      emit(user.username, "account", payment.account);
      emit(user.username, "payment", payment);

      seen.push(preimage);
      seen.push(hash);

      l.info("sent lightning", user.username, (total - fee), fee);

    });

      return payment;
};
