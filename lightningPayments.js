module.exports = (app, db, lna, lnb, emit, payments) => {
  const handlePayment = async msg => {
    if (!msg.settled) return;

    let payment = await db.Payment.findOne({
      include: { model: db.User, as: "user" },
      where: {
        hash: msg.payment_request
      }
    });

    if (!payment) return;

    payment.received = true;
    payment.user.balance += parseInt(msg.value);
    payment.rate = app.get("rates").ask;

    await payment.save();
    await payment.user.save();
    payments.push(msg.payment_request);

    emit(payment.user.username, "invoice", msg);
    emit(payment.user.username, "user", payment.user);
  };

  const invoices = lna.subscribeInvoices({});
  invoices.on("data", handlePayment);

  const invoicesb = lnb.subscribeInvoices({});
  invoicesb.on("data", handlePayment);
};
