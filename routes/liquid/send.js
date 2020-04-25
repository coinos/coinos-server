const reverse = require("buffer-reverse");

module.exports = async (req, res) => {
  let { user } = req;
  let {
    address,
    asset,
    tx: { hex }
  } = req.body;

  const isChange = async address => 
    ((await lq.getAddressInfo(address)).ismine) &&
    (!Object.keys(addresses).includes(address) || 
    address === user.liquid);

  const unblinded = await lq.unblindRawTransaction(hex);
  tx = await lq.decodeRawTransaction(unblinded.hex);
  l.info("decoded", tx);
  
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

  l.info("attempting liquid payment", user.username, amount, fee);

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
    l.warn("insufficient funds for liquid payment", user.username);
    return res.status(500).send("Not enough satoshis");
  }

  try {
    if (config.liquid.walletpass)
      await lq.walletPassphrase(config.liquid.walletpass, 300);

    hex = await lq.blindRawTransaction(hex);
    rawtx = (await lq.signRawTransactionWithWallet(hex)).hex;
    let txid = await lq.sendRawTransaction(rawtx);

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
