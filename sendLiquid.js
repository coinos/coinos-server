const bitcoin = require("bitcoinjs-lib");
const config = require("./config");
const reverse = require("buffer-reverse");
const BitcoinCore = require("bitcoin-core");

const l = require("pino")();
const toSats = n => parseInt((n * 100000000).toFixed())

const bc = new BitcoinCore(config.liquid);

module.exports = (addresses, app, db, emit) => async (req, res) => {
  let { user } = req;
  let {
    address,
    tx: { hex }
  } = req.body;

  const isChange = async address => 
    !((await bc.getAddressInfo(address)).ismine) ||
    !Object.keys(addresses).includes(address) || 
    address === user.liquid;

  const unblinded = await bc.unblindRawTransaction(hex);
  tx = await bc.decodeRawTransaction(unblinded.hex);
  
  let total = 0;
  let change = 0;
  let fee = 0;

  for (let i = 0; i < tx.vout.length; i++) {
    let o = tx.vout[i];
    total += toSats(o.value);
    if (o.scriptPubKey.type === 'fee') fee = toSats(o.value);
   
    if (o.scriptPubKey.addresses) {
      if ((await isChange(o.scriptPubKey.addresses[0]))) {
        change += toSats(o.value);
      }
    }
  } 

  total = total - change;
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
        l.warn("amount exceeds balance", { amount, fee, balance });
        throw new Error("insufficient funds");
      }

      req.user.balance -= total;
      await user.save({ transaction });
    });
  } catch (e) {
    l.error("balance check failed", e);
    return res.status(500).send("Not enough satoshis");
  }

  try {
    if (config.liquid.walletpass)
      await bc.walletPassphrase(config.liquid.walletpass, 300);

    hex = await bc.blindRawTransaction(hex);
    rawtx = (await bc.signRawTransactionWithWallet(hex)).hex;
    let txid = await bc.sendRawTransaction(rawtx);

    await db.transaction(async transaction => {
      await user.save({ transaction });
      emit(user.username, "user", user);
      l.info("total", total);

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
          asset: 'LBTC'
        },
        { transaction }
      );

      l.info("sent liquid", user.username, total);
      emit(user.username, "payment", payment);
      res.send(payment);
    });
  } catch (e) {
    l.error("liquid send failed", e);
    return res.status(500).send(e.message);
  }
};
