const bolt11 = require("bolt11");

module.exports = async (req, res) => {
  let { payuser, amount } = req.body;

  let user = await db.User.findOne({
    where: {
      username: payuser
    }
  });

  const account = await db.Account.findOne({
    where: {
      user_id: user.id,
      asset: config.liquid.btcasset
    }
  });

  l.info("paying user", req.user.username, payuser);

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
    account_id: account.id,
    hash,
    amount,
    rate: app.get("rates")[req.user.currency],
    currency: req.user.currency,
    tip: 0,
    confirmed: true,
    received: false,
    network: "LNBTC"
  });

  req.url = "/lightning/send";
  let payreq = bolt11.decode(hash);
  req.body.payreq = hash;
  return app._router.handle(req, res);
};
