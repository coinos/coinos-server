module.exports = async (req, res) => {
  let err = m => res.status(500).send(m);
  let { amount, tip } = req.body;

  let invoice;
  try {
    invoice = await lnb.addInvoice({ value: amount + tip });
  } catch (e) {
    return err(e.message);
  }

  res.send(invoice.payment_request);
};
