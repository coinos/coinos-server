module.exports = ah(async (req, res) => {
  try {
    const { user } = req;
    let hash = await bc.sendRawTransaction(req.body.tx);

    if (user) {
      let { account } = user;
      let payment = await db.Payment.create({
        ...req.body.payment,
        hash,
        amount: -req.body.payment.amount,
        tip: 0,
        account_id: account.id,
        user_id: user.id,
        rate: app.get("rates")[user.currency],
        currency: user.currency,
        confirmed: true,
        received: false,
        network: "bitcoin",
      });

      account.balance += payment.amount - payment.fee;
      await account.save();

      payment = payment.get({ plain: true });
      payment.account = account.get({ plain: true });
      emit(user.username, "payment", payment);
      emit(user.username, "account", payment.account);
      res.send(payment);
    } else {
      res.send(result);
    }
  } catch (e) {
    res.status(500).send(e.message);
  }
});
