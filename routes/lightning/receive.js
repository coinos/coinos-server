const handlePayment = async msg => {
  if (!msg.settled) return;
  l.info("lightning strikes!", msg.payment_request);

  let invoice = await db.Invoice.findOne({
    include: { model: db.User, as: "user" },
    where: {
      text: msg.payment_request
    }
  });

  if (!invoice) return;

  const { user } = invoice;
  const amount = parseInt(msg.value);

  const payment = await db.Payment.create({
    user_id: user.id,
    hash: invoice.text,
    amount,
    currency: user.currency,
    rate: app.get("rates")[user.currency],
    received: true,
    confirmed: true,
    asset: 'LNBTC',
  });

  invoice.received = msg.value;
  user.balance += amount;

  await invoice.save();
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
