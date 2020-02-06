const bitcoin = require("bitcoinjs-lib");
const config = require("./config");
const reverse = require("buffer-reverse");

const l = console.log;
const SATS = 100000000;

module.exports = (app, bc, db, emit) => async (req, res) => {
  let { address, amount } = req.body;
  let rawtx, hex, fee, total;

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
    total = amount + fee;
  } catch (e) {
    l(e);
    return res.status(500).send(e.message);
  }

  try {
    l("sending coins", req.user.username, amount, fee, address);
    await db.transaction(async transaction => {
      let { balance } = await db.User.findOne({
        where: {
          username: req.user.username
        },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (amount !== balance && total > balance) {
        l("amount exceeds balance", amount, fee, balance);
        throw new Error("insufficient funds");
      }

      req.user.balance -= total;
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

    await db.transaction(async transaction => {
      await req.user.save({ transaction });
      emit(req.user.username, "user", req.user);

      const payment = await db.Payment.create(
        {
          amount: -total,
          fee,
          user_id: req.user.id,
          hash: txid,
          rate: app.get("rates")[req.user.currency],
          currency: req.user.currency,
          address,
          confirmed: true,
          received: false,
          asset: 'BTC',
        },
        { transaction }
      );

      emit(req.user.username, "payment", payment);
      res.send(payment);
    });
  } catch (e) {
    l(e);
    return res.status(500).send(e.message);
  }
};
