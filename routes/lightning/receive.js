const asset = "LNBTC";

const handlePayment = async msg => {
  if (!msg.settled) return;

  const invoice = await db.Invoice.findOne({
    where: {
      text: msg.payment_request
    }
  });

  if (!invoice) return;

  const { text: hash, currency, rate, tip, user_id } = invoice;
  const amount = parseInt(msg.amt_paid_sat) - tip;

  const account = await db.Account.findOne({
    where: {
      user_id,
      asset: config.liquid.btcasset
    }
  });

  let payment = await db.Payment.create({
    account_id: account.id,
    user_id,
    hash,
    amount,
    currency,
    preimage: msg.r_preimage.toString('hex'),
    rate,
    received: true,
    confirmed: true,
    network: "LNBTC",
    tip
  });

  invoice.received += amount + tip;
  account.balance += amount + tip;

  await account.save();
  await invoice.save();
  await payment.save();
  payments.push(msg.payment_request);

  let user = await getUserById(user_id);

  payment = payment.get({ plain: true });
  payment.account = account.get({ plain: true });
  emit(user.username, "payment", payment);
  emit(user.username, "user", user);

  l.info(
    "lightning payment received",
    user.username,
    payment.amount,
    payment.tip,
  );
};

const invoices = lna.subscribeInvoices({});
invoices.on("data", handlePayment);

const invoicesb = lnb.subscribeInvoices({});
invoicesb.on("data", handlePayment);
