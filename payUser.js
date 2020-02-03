module.exports = (app, db, lnb) => async (req, res) => {
  let { payuser, amount } = req.body;

  let user = await db.User.findOne({
    where: {
      username: payuser
    }
  });

  if (!user) {
    return res.status(500).send("Couldn't find the user you're trying to pay");
  }
  let err = m => res.status(500).send(m);

  let invoice;
  try {
    invoice = await lnb.addInvoice({ value: amount });
  } catch (e) {
    return err(e.message);
  }

  let hash = invoice.payment_request;

  await db.Payment.create({
    user_id: user.id,
    hash,
    amount,
    rate: app.get("rates")[req.user.currency],
    currency: req.user.currency,
    tip: 0,
    confirmed: true,
    received: false,
  });

  req.url = "/sendPayment";
  req.body.payreq = invoice.payment_request;
  return app._router.handle(req, res);
};
