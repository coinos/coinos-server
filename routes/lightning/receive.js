const asset = "LNBTC";

const handlePayment = async msg => {
  try {
  await db.transaction(async transaction => {
  if (!msg.settled) return;

  const invoice = await db.Invoice.findOne({
    where: {
      text: msg.payment_request
    }
  });

  if (!invoice) return l.warn("received lightning with no invoice", msg.payment_request);

  const { text: hash, currency, rate, tip, user_id } = invoice;
  const amount = parseInt(msg.amt_paid_sat) - tip;

  const account = await db.Account.findOne({
    where: {
      user_id,
      asset: config.liquid.btcasset
    }, 
    include: {
      model: db.User,
      as: 'user',
    },
    lock: transaction.LOCK.UPDATE,
    transaction
  });

    const { user } = account;

  let preimage = msg.r_preimage.toString("hex");

  let payment = await db.Payment.create({
    account_id: account.id,
    user_id,
    hash,
    amount,
    currency,
    preimage,
    rate,
    received: true,
    confirmed: true,
    network: "LNBTC",
    tip
  },
    { transaction });

    let total = amount + tip;
  invoice.received += total;
  account.balance += total;

  await account.save({ transaction });
  await invoice.save({ transaction });
  await payment.save({ transaction });
  payments.push(msg.payment_request);

  payment = payment.get({ plain: true });
  payment.account = account.get({ plain: true });
  emit(user.username, "payment", payment);
  emit(user.username, "account", payment.account);
  notify(user, `Received ${total} SAT`);

  l.info(
    "lightning payment received",
    user.username,
    payment.amount,
    payment.tip
  );
  });
  } catch(e) {
    l.error("problem receiving lightning payment", e.message);
  } 
};

if (config.lna.clightning) {
  const poll = async ln => {
    const wait = async i => {
      const {
        bolt11: payment_request,
        pay_index,
        status,
        msatoshi_received,
        payment_preimage: r_preimage
      } = await ln.waitanyinvoice(i);

      let settled = status === "paid";
      let amt_paid_sat = parseInt(msatoshi_received / 1000);

      await handlePayment({
        payment_request,
        settled,
        amt_paid_sat,
        r_preimage
      });
      wait(pay_index);
    };

    const { invoices } = await ln.listinvoices();
    wait(Math.max(...invoices.map(i => i.pay_index).filter(n => n)));
  };

  poll(lna);
  poll(lnb);
} else {
  const invoices = lna.subscribeInvoices({});
  invoices.on("data", handlePayment);

  const invoicesb = lnb.subscribeInvoices({});
  invoicesb.on("data", handlePayment);
}
