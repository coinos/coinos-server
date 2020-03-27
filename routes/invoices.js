app.post("/invoice", auth, async (req, res) => {
  let { invoice } = req.body;
  invoice.user_id = req.user.id;
  invoice.currency = req.user.currency;
  res.send(await db.Invoice.create(invoice));
});
