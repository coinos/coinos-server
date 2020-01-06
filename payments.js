const createLnrpc = require("./lib/createLnrpc");
const config = require("./config");

module.exports = async (app, auth, addresses, bc, db, emit, seen, payments) => {
  const lna = await createLnrpc(config.lna);
  const lnb = await createLnrpc(config.lnb);

  require("./bitcoinPayments")(app, bc, db, addresses, payments, emit);
  require("./lightningPayments")(app, db, lna, lnb, emit, payments);

  app.post(
    "/sendPayment",
    auth,
    require("./sendPayment")(app, db, emit, seen, lna, lnb)
  );
  app.post("/payUser", auth, require("./payUser")(app, db, lnb));
  app.post("/sendCoins", auth, require("./sendCoins")(app, bc, db, emit));
  app.post("/addInvoice", auth, require("./addInvoice")(app, db, lnb));
  app.get("/payments", auth, async (req, res) => {
    const payments = await db.Payment.findAll({
      where: { user_id: req.user.id },
      order: [['id', 'DESC']],
    });

    emit(req.user.username, "payments", payments);
    res.send(payments);
  });
};
