const asset = "LNBTC";

const handlePayment = async msg => {
  if (!msg.settled) return;

  const invoice = await db.Invoice.findOne({
    include: { model: db.User, as: "user" },
    where: {
      text: msg.payment_request
    }
  });

  if (!invoice) return;

  const { text: hash, currency, rate, tip, user } = invoice;
  const amount = parseInt(msg.value) - tip;

  const payment = await db.Payment.create({
    user_id: user.id,
    hash,
    amount,
    currency,
    rate,
    received: true,
    confirmed: true,
    asset,
    tip,
  });

  invoice.received += amount + tip;
  user.balance += amount + tip;

  await invoice.save();
  await payment.save();
  await user.save();
  payments.push(msg.payment_request);
  l.info("lightning payment received", user.username, payment.amount, payment.tip);

  emit(user.username, "payment", payment);
  emit(user.username, "user", user);
};

const invoices = lna.subscribeInvoices({});
invoices.on("data", handlePayment);

const invoicesb = lnb.subscribeInvoices({});
invoicesb.on("data", handlePayment);
