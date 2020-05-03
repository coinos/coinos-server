const bolt11 = require("bolt11");

module.exports = async (req, res) => {
  let hash = req.body.payreq;
  let payreq = bolt11.decode(hash);
  let { amount, route } = req.body;
  let { user } = req;

  if (!amount) amount = payreq.satoshis;

  l.info("attempting lightning payment", user.username, amount);

  if (seen.includes(hash)) {
    l.warn("attempted to pay a paid invoice", user.username);
    return res.status(500).send("Invoice has been paid, can't pay again");
  }

  try {
    await db.transaction(async transaction => {
      let account = await db.Account.findOne({
        where: {
          user_id: user.id,
          asset: config.liquid.btcasset
        },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (account.balance < amount) {
        throw new Error("Insufficient funds");
      }

      let m = await lna.sendPaymentSync({
        amt: amount,
        payment_request: hash
      });

      if (m.payment_error) return res.status(500).send(m.payment_error);

      if (seen.includes(m.payment_preimage)) {
        l.warn("duplicate payment detected", m.payment_preimage);
        throw new Error("Duplicate payment detected");
      }

      let total = parseInt(m.payment_route.total_amt);
      let fee = m.payment_route.total_fees;

      account.balance -= total;
      await account.save({ transaction });

      let payment = await db.Payment.create({
        amount: -total,
        account_id: account.id,
        user_id: user.id,
        hash,
        preimage: m.payment_preimage.toString("hex"),
        rate: app.get("rates")[user.currency],
        currency: user.currency,
        confirmed: true,
        network: "LNBTC"
      }, { transaction });

      payment = payment.get({ plain: true });
      payment.account = account.get({ plain: true });

      seen.push(m.payment_preimage);
      l.info("sent lightning", user.username, -payment.amount);

      user = await getUser(user.username, transaction);
      emit(user.username, "user", user);

      if (payreq.payeeNodeKey === config.lnb.id) {
        lna.addInvoice({ value: amount }, (err, invoice) => {
          let payback = lnb.sendPayment(lnb.meta, {});

          /* eslint-disable-next-line */
          let { payment_request } = invoice;
          /* eslint-disable-next-line */
          payback.write({ payment_request });
        });
      }

      seen.push(hash);
      res.send(payment);
    });
  } catch (e) {
    l.error(
      "problem sending lightning payment",
      user.username,
      user.balance,
      e.message
    );
    return res.status(500).send(e.message);
  }
};
