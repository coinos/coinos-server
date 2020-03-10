const bitcoin = require("bitcoinjs-lib");
const config = require("./config");
const reverse = require("buffer-reverse");

const l = require("pino")();
const toSats = n => parseInt((n * 100000000).toFixed())

module.exports = (addresses, app, bc, db, emit) => async (req, res) => {
  let { user } = req;
  let { address, tx } = req.body;
  let { hex } = tx;

  let fee = toSats(tx.fee);

  const isChange = async address => 
    !((await bc.getAddressInfo(address)).ismine) ||
    !Object.keys(addresses).includes(address) || 
    address === user.address;

  tx = await bc.decodeRawTransaction(hex);

  let total = 0;
  let change = 0;

  for (let i = 0; i < tx.vout.length; i++) {
    let o = tx.vout[i];
    total += toSats(o.value);
   
    if (o.scriptPubKey.addresses) {
      if ((await isChange(o.scriptPubKey.addresses[0]))) {
        change += toSats(o.value);
      }
    }
  } 

  total = (total - change) + fee;
  let amount = total - fee;

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

    hex = (await bc.signRawTransactionWithWallet(hex)).hex;
    let txid = await bc.sendRawTransaction(hex);

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
          asset: "BTC"
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
