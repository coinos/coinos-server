// Can use this file to run custom scripts on startup

/*
(async () => {
  let invoice = await db.Invoice.findOne({
    where: { id: 47391 }
  });

  let payment = await db.Payment.findOne({
    where: { invoice_id: 47391 },

    include: {
      model: db.Account,
      as: "account"
    }
  });

  console.log(invoice.id, payment.id);
  try {
    await callWebhook(invoice, payment);
  } catch (e) {
    console.log("uh oh", e);
  }
})();
*/
