const reverse = require("buffer-reverse");

module.exports = async (req, res) => {
  let { user } = req;
  let {
    address,
    tx: { hex }
  } = req.body;

  const isChange = async address =>
    (await lq.getAddressInfo(address)).ismine &&
    (!Object.keys(addresses).includes(address) || address === user.liquid);

  const unblinded = await lq.unblindRawTransaction(hex);
  tx = await lq.decodeRawTransaction(unblinded.hex);

  let totals = {};
  let change = {};
  let fee = 0;

  for (let i = 0; i < tx.vout.length; i++) {
    let {
      asset,
      value,
      scriptPubKey: { type, addresses }
    } = tx.vout[i];

    if (!totals[asset]) totals[asset] = change[asset] = 0;
    totals[asset] += toSats(value);
    if (type === "fee") fee = toSats(value);

    if (addresses) {
      if (await isChange(addresses[0])) {
        change[asset] += toSats(value);
      }
    }
  }

  let assets = Object.keys(totals);
  for (let i = 0; i < assets.length; i++) {
    let asset = assets[i];
    let total = totals[asset];
    if (change[asset]) total -= change[asset];

    l.info("attempting liquid payment", user.username, asset, total, fee);

    try {
      await db.transaction(async transaction => {
        let account = await db.Account.findOne({
          where: {
            user_id: user.id,
            asset
          },
          lock: transaction.LOCK.UPDATE,
          transaction
        });

        if (total > account.balance) {
          l.warn("amount exceeds balance", {
            total,
            fee,
            balance: account.balance
          });
          throw new Error("insufficient funds");
        }

        account.balance -= total;
        await account.save({ transaction });

        try {
          if (config.liquid.walletpass)
            await lq.walletPassphrase(config.liquid.walletpass, 300);

          hex = await lq.blindRawTransaction(hex);
          rawtx = (await lq.signRawTransactionWithWallet(hex)).hex;
          let txid = await lq.sendRawTransaction(rawtx);

          const payment = await db.Payment.create({
            amount: -total,
            account_id: account.id,
            fee,
            user_id: user.id,
            hash: txid,
            rate: app.get("rates")[user.currency],
            currency: user.currency,
            address,
            confirmed: true,
            received: false,
            network: "LBTC"
          }, { transaction });

          payment.account = account;

          user = await getUser(user.username);
          emit(user.username, "user", user);
          res.send(payment);
        } catch (e) {
          l.error("liquid send failed", e);
          return res.status(500).send(e.message);
        }
      });
    } catch (e) {
      l.warn("insufficient funds for liquid payment", user.username, e.message);
      return res.status(500).send("Not enough satoshis");
    }
  }
};
