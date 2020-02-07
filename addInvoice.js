module.exports = (app, db, lnb) => async (req, res) => {
  let err = m => res.status(500).send(m);
  let { amount, address, tip } = req.body;

  let invoice;
  try {
    invoice = await lnb.addInvoice({ value: amount });
  } catch (e) {
    return err(e.message);
  }

  let hash = invoice.payment_request;
  if (address) hash = address;

  await db.Payment.create({
    user_id: req.user.id,
    hash,
    amount,
    currency: "CAD",
    rate: app.get("rates")[req.user.currency],
    tip,
    confirmed: 1,
    asset: 'LNBTC',
  });

  res.send(invoice);
};
