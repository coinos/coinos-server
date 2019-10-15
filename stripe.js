const config = require("./config");
const l = console.log;

module.exports = (auth, app, db, emit) => {
  app.post("/buy", auth, async (req, res) => {
    const stripe = require("stripe")(config.stripe);
    const { token, amount, sat } = req.body;
    let dollarAmount = parseInt(amount / 100);

    if (dollarAmount > req.user.limit) return res.status(500).end();

    try {
      const charge = await stripe.charges.create({
        amount,
        currency: "cad",
        description: "Bitcoin",
        source: token
      });

      req.user.balance += parseInt(sat);
      req.user.limit -= dollarAmount;
      await req.user.save();
      emit(req.user.username, "user", req.user);

      await db.Payment.create({
        user_id: req.user.id,
        hash: charge.balance_transaction,
        amount: parseInt(sat),
        currency: "CAD",
        rate: app.get("rates").ask,
        received: true,
        tip: 0
      });

      res.send(`Bought ${amount}`);
    } catch (e) {
      l(e);
      res.status(500).send(e);
    }
  });
};
