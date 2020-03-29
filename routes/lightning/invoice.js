module.exports = async (req, res) => {
  const { amount, tip } = req.body;

  l.info("adding lightning invoice", req.user.username, amount, tip);

  try {
    const invoice = await lnb.addInvoice({ value: amount + tip });
    res.send(invoice.payment_request);
  } catch (e) {
    l.error("problem creating invoice", e.message);
    res.status(500).send(e.message);
  }
};
