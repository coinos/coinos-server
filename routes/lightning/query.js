const bolt11 = require("bolt11");

module.exports = async (req, res) => {
  let { amount, payreq } = req.body;

  try {
    let invoice = await db.Invoice.findOne({
      where: { text: payreq },
      include: {
        model: db.User,
        as: "user"
      }
    });

    if (invoice) emit(req.user.username, "to", invoice.user);

    payreq = bolt11.decode(payreq);

    res.send(
      await lna.queryRoutes({
        pub_key: payreq.payeeNodeKey,
        amt: amount || payreq.satoshis
      })
    );
  } catch (e) {
    res.status(500).send(e.message);
  }
};
