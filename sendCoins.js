const bitcoin = require("bitcoinjs-lib");
const config = require("./config");
const reverse = require("buffer-reverse");

const l = console.log;
const SATS = 100000000;

module.exports = (app, bc, db, emit) => async (req, res) => {
  let { address, amount } = req.body;
  amount = parseInt(amount);

  let rawtx = await bc.createRawTransaction([], {
    [address]: (amount / SATS).toFixed(8)
  });
  rawtx = await bc.fundRawTransaction(rawtx, {
    subtractFeeFromOutputs: amount === req.user.balance ? [0] : []
  });
  let { hex, fee } = rawtx;
  fee = parseInt(fee * SATS);

  rawtx = (await bc.signRawTransactionWithWallet(hex)).hex;

  l("sending coins", req.user.username, amount, address);

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

      if (amount !== balance && amount + fee > balance) {
        l("amount exceeds balance", amount, fee, balance);
        throw new Error("insufficient funds");
      }

      req.user.balance -= amount + fee;
      await req.user.save({ transaction });
    });
  } catch (e) {
    return res.status(500).send("Not enough satoshis");
  }

  try {
    if (config.bitcoin.walletpass)
      await bc.walletPassphrase(config.bitcoin.walletpass, 300);

    let txid = await bc.sendRawTransaction(rawtx);

    let txhex = await bc.getRawTransaction(txid);
    let tx = bitcoin.Transaction.fromHex(txhex);

    let total = Math.min(amount + fee, req.user.balance);
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

    res.send({ txid, tx, amount, fees: fee });
  } catch (e) {
    l(e);
    res.status(500).send(e.message);
  }
};
