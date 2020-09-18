const { Op } = require("sequelize");

app.get("/invoice", auth, ah(async (req, res, next) => {
  try {
    const invoice = await db.Invoice.findOne({
      where: {
        uuid: req.query.uuid,
      },
    });

    res.send(invoice);
  } catch (e) {
    l.error("couldn't find invoice", e);
  }
}));

app.post("/invoice", ah(async (req, res, next) => {
  let { invoice, user } = req.body;
  if (!user) ({ user } = req);
  else {
    user = await db.User.findOne({
      where: {
        username: user.username,
      } 
    }); 
  } 
  if (!user) throw new Error("user not provided");
  invoice.user_id = user.id;
  invoice.account_id = user.account_id;

  l.info(
    "creating invoice",
    user.username,
    invoice.network,
    invoice.amount,
    invoice.tip,
    invoice.currency,
    invoice.rate.toFixed(2)
  );

  if (invoice.network === "liquid") {
    invoice.unconfidential = (
      await lq.getAddressInfo(invoice.address)
    ).unconfidential;
  }

  if (!invoice.tip) invoice.tip = 0;

  const exists = await db.Invoice.findOne({
    where: {
      [Op.or]: {
        address: invoice.address || "",
        unconfidential: invoice.unconfidential || "",
        text: invoice.text,
      },
    },
  });

  invoice = exists ? await exists.update(invoice) : await db.Invoice.create(invoice);
  addresses[invoice.address] = user.username;
  if (invoice.unconfidential) addresses[invoice.unconfidential] = user.username;
  res.send(invoice);
}));
