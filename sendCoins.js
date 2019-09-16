const bitcoin = require("bitcoinjs-lib");
const config = require("./config");
const reverse = require("buffer-reverse");

const l = console.log;

module.exports = (app, bc, db, emit) => async (req, res) => {
  const MINFEE = 3000;

  let { address, amount } = req.body;

  l("sending coins", req.user.username, amount, address);

  if (amount === req.user.balance) {
    amount = req.user.balance - MINFEE;
  }

  try {
    await db.transaction(async transaction => {
      let { balance } = await db.User.findOne(
        {
          where: {
            username: req.user.username
          }
        },
        { transaction }
      );

      if (amount > balance) {
        l("amount exceeds balance", amount, balance);
        throw new Error("insufficient funds");
      }

      req.user.balance -= parseInt(amount) + 10000;
      await req.user.save({ transaction });
    });
  } catch (e) {
    return res.status(500).send("Not enough satoshis");
  }

  try {
    if (config.bitcoin.walletpass)
      await bc.walletPassphrase(config.bitcoin.walletpass, 300);

    let txid = await bc.sendToAddress(address, (amount / 100000000).toFixed(8));

    let txhex = await bc.getRawTransaction(txid);
    let tx = bitcoin.Transaction.fromHex(txhex);

    let inputTotal = await tx.ins.reduce(async (a, input) => {
      let h = await bc.getRawTransaction(reverse(input.hash).toString("hex"));
      return a + bitcoin.Transaction.fromHex(h).outs[input.index].value;
    }, 0);
    let outputTotal = tx.outs.reduce((a, b) => a + b.value, 0);

    let fees = inputTotal - outputTotal;
    let total = Math.min(parseInt(amount) + fees, req.user.balance);
    req.user.balance += 10000 - fees;
    if (req.user.balance < 0) req.user.balance = 0;

    await db.transaction(async transaction => {
      await req.user.save({ transaction });
      emit(req.user.username, "user", req.user);

      await db.Payment.create(
        {
          amount: -total,
          user_id: req.user.id,
          hash: txid,
          rate: app.get("rates").ask,
          currency: "CAD"
        },
        { transaction }
      );
    });

    res.send({ txid, tx, amount, fees });
  } catch (e) {
    l(e);
    res.status(500).send(e.message);
  }
};
