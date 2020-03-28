const bolt11 = require("bolt11");

module.exports = async (req, res) => {
  let { payuser, amount } = req.body;

  let user = await db.User.findOne({
    where: {
      username: payuser
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
    hash,
    amount,
    rate: app.get("rates")[req.user.currency],
    currency: req.user.currency,
    tip: 0,
    confirmed: true,
    received: false,
    asset: "LNBTC"
  });

  req.url = "/lightning/send";
  let payreq = bolt11.decode(hash);
  try {
    const { routes } = await lna.queryRoutes({
      pub_key: payreq.payeeNodeKey,
      amt: payreq.satoshis
    });
    if (routes.length) req.body.route = routes[0];
    else return res.status(500).send("No route available");
  } catch (e) {
    l.warn("no route available", e);
    return res.status(500).send("No route available");
  }
  req.body.payreq = hash;

  return app._router.handle(req, res);
};
