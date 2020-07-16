const { Op } = require("sequelize");

app.get("/invoice", auth, async (req, res) => {
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
});

app.post("/invoice", auth, async (req, res) => {
  const { invoice } = req.body;
  invoice.user_id = req.user.id;

  l.info(
    "creating invoice",
    invoice.text,
    req.user.username,
    invoice.network,
    invoice.amount,
    invoice.tip,
    invoice.currency,
    invoice.rate.toFixed(2)
  );

  if (invoice.network === "LBTC") {
    invoice.unconfidential = (
      await lq.getAddressInfo(invoice.address)
    ).unconfidential;
  }

  const exists = await db.Invoice.findOne({
    where: {
      [Op.or]: {
        address: invoice.address || "undefined",
        text: invoice.text,
      },
    },
  });

  res.send(
    exists ? await exists.update(invoice) : await db.Invoice.create(invoice)
  );
});
