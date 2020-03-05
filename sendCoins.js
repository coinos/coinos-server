const bitcoin = require("bitcoinjs-lib");
const config = require("./config");
const reverse = require("buffer-reverse");

const l = require("pino")();
const SATS = 100000000;

module.exports = (app, bc, db, emit) => async (req, res) => {
  let { user } = req;
  let { address, amount } = req.body;
  let rawtx, hex, fee, total;

  try {
    amount = parseInt(amount);

    rawtx = await bc.createRawTransaction([], {
      [address]: (amount / SATS).toFixed(8)
    });

    rawtx = await bc.fundRawTransaction(rawtx, {
      subtractFeeFromOutputs: amount === user.balance ? [0] : []
    });

    ({ hex, fee } = rawtx);
    fee = parseInt(fee * SATS);
    total = amount + fee;
  } catch (e) {
    l.error(e);
    return res.status(500).send(e.message);
  }

  try {
    await db.transaction(async transaction => {
      let { balance } = await db.User.findOne({
        where: {
          username: user.username
        },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (amount !== balance && total > balance) {
        l.error("amount exceeds balance", amount, fee, balance);
        throw new Error("insufficient funds");
      }

      user.balance -= total;
      await user.save({ transaction });
    });
  } catch (e) {
    l.error(e);
    return res.status(500).send("Not enough satoshis");
  }

  try {
    if (config.bitcoin.walletpass)
      await bc.walletPassphrase(config.bitcoin.walletpass, 300);

    rawtx = (await bc.signRawTransactionWithWallet(hex)).hex;
    let txid = await bc.sendRawTransaction(rawtx);

    let tx = bitcoin.Transaction.fromHex(rawtx);

    await db.transaction(async transaction => {
      await user.save({ transaction });
      emit(user.username, "user", user);

      const payment = await db.Payment.create(
        {
          amount: -total,
          fee,
          user_id: user.id,
          hash: txid,
          rate: app.get("rates")[user.currency],
          currency: user.currency,
          address,
          confirmed: true,
          received: false,
          asset: 'BTC',
        },
        { transaction }
      );

      l.info("sent bitcoin", user.username, total);
      emit(user.username, "payment", payment);
      res.send(payment);
    });
  } catch (e) {
    l.error(e);
    return res.status(500).send(e.message);
  }
};
