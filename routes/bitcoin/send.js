const btc = config.liquid.btcasset;

module.exports = ah(async (req, res) => {
  let { user } = req;
  let { address, memo, tx } = req.body;
  let { hex } = tx;

  let fee = toSats(tx.fee);
  if (fee < 0) throw new Error("fee cannot be negative");

  const isChange = async ({ address }) =>
    (await bc.getAddressInfo(address)).ismine &&
    !Object.keys(addresses).includes(address);

  tx = await bc.decodeRawTransaction(hex);

  let total = 0;
  let change = 0;

  for (let i = 0; i < tx.vout.length; i++) {
    let o = tx.vout[i];
    total += toSats(o.value);

    if (await isChange(o.scriptPubKey)) {
      change += toSats(o.value);
    }
  }

  total = total - change + fee;
  let amount = total - fee;

  let account, params;
  try {
    await db.transaction(async transaction => {
      account = await db.Account.findOne({
        where: {
          id: user.account_id
        },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (account.asset !== btc) {
        account = await db.Account.findOne({
          where: {
            user_id: user.id,
            asset: btc,
            pubkey: null
          },
          lock: transaction.LOCK.UPDATE,
          transaction
        });
      }

      if (total > account.balance) {
        l.error("amount exceeds balance", amount, fee, account.balance);
        throw new Error("Insufficient funds");
      }

      await account.decrement({ balance: total }, { transaction });
      await account.reload({ transaction });
    });

    params = {
      amount: -amount,
      fee,
      memo,
      account_id: account.id,
      user_id: user.id,
      rate: app.get("rates")[user.currency],
      currency: user.currency,
      address,
      confirmed: true,
      received: false,
      network: "bitcoin"
    };

    if (config.bitcoin.walletpass)
      await bc.walletPassphrase(config.bitcoin.walletpass, 300);

    hex = (await bc.signRawTransactionWithWallet(hex)).hex;
    params.hash = await bc.sendRawTransaction(hex);

    let payment = await db.Payment.create(params);

    payment = payment.get({ plain: true });
    payment.account = account.get({ plain: true });

    emit(user.username, "payment", payment);
    res.send(payment);

    payments.push(params.hash);
    l.info("sent bitcoin", user.username, total);
  } catch (e) {
    l.error("error sending bitcoin", e.message);
    return res.status(500).send(e.message);
  }
});
