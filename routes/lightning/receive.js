const handlePayment = async msg => {
  if (!msg.settled) return;

  let payment = await db.Payment.findOne({
    include: { model: db.User, as: "user" },
    where: {
      hash: msg.payment_request
    }
  });

  if (!payment) return;

  const { user } = payment;

  payment.received = true;
  user.balance += parseInt(msg.value);
  payment.rate = app.get("rates")[user.currency];
  payment.confirmed = true;
  payment.currency = user.currency;

  await payment.save();
  await user.save();
  payments.push(msg.payment_request);
  l.info("lightning payment received", user.username, payment.amount);

  emit(user.username, "payment", payment);
  emit(user.username, "user", user);
};

const invoices = lna.subscribeInvoices({});
invoices.on("data", handlePayment);

const invoicesb = lnb.subscribeInvoices({});
invoicesb.on("data", handlePayment);
