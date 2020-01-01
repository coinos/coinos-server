const bitcoin = require("bitcoinjs-lib");
const config = require("./config");
const reverse = require("buffer-reverse");

const l = console.log;
const SATS = 100000000;

module.exports = (app, bc, db, emit) => async (req, res) => {
  let { address, amount } = req.body;
  let rawtex, hex, fee;

  try {
    amount = parseInt(amount);

    rawtx = await bc.createRawTransaction([], {
      [address]: (amount / SATS).toFixed(8)
    });

    rawtx = await bc.fundRawTransaction(rawtx, {
      subtractFeeFromOutputs: amount === req.user.balance ? [0] : []
    });

    ({ hex, fee } = rawtx);
    fee = parseInt(fee * SATS);
  } catch (e) {
    l(e);
    return res.status(500).send(e.message);
  }

  try {
    l("sending coins", req.user.username, amount, address);
    await db.transaction(async transaction => {
      let { balance } = await db.User.findOne({
        where: {
          username: req.user.username
        },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (amount !== balance && amount + fee > balance) {
        l("amount exceeds balance", amount, fee, balance);
        throw new Error("insufficient funds");
      }

      req.user.balance -= amount + fee;
      await req.user.save({ transaction });
    });
  } catch (e) {
    l(e);
    return res.status(500).send("Not enough satoshis");
  }

  try {
    if (config.bitcoin.walletpass)
      await bc.walletPassphrase(config.bitcoin.walletpass, 300);

    rawtx = (await bc.signRawTransactionWithWallet(hex)).hex;
    let txid = await bc.sendRawTransaction(rawtx);

    let tx = bitcoin.Transaction.fromHex(rawtx);

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
          rate: app.get("ask"),
          currency: "CAD",
          address
        },
        { transaction }
      );
    });

    res.send({ txid, tx, amount, fees: fee });
  } catch (e) {
    l(e);
    return res.status(500).send(e.message);
  }
};
