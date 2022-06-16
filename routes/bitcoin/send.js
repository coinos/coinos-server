const btc = config.liquid.btcasset;
let { computeConversionFee, conversionFeeReceiver } = require('./conversionFee.js');

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

  // get conversion fee
  // 'total' refers to the total before the conversion fee
  // (i.e. the total bitcoin that leaves this server)
  let conversionFee = computeConversionFee(amount);

  try {
    // withdraw bitcoin
    await db.transaction(async transaction => {
      let account = await db.Account.findOne({
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
        throw new Error("low balance");
      } else if (total + conversionFee > account.balance) {
        l.error("total (after conversion fee) exceeds balance", amount, fee, account.balance);
        throw new Error("low balance (after conversion fee)");
      }

      // use user's credits to reduce fee, if available
      let conversionFeeDeduction = Math.min(account.fee_credits, conversionFee);
      if (conversionFeeDeduction) {
        await account.decrement({ fee_credits: conversionFeeDeduction }, { transaction });
        await account.reload({ transaction });
        conversionFee -= conversionFeeDeduction;
      }

      await account.decrement({ balance: (total + conversionFee) }, { transaction });
      await account.reload({ transaction });

      let receiverAccount = await db.Account.findOne({
        where: {
          "$user.username$": conversionFeeReceiver
        },
        include: [
          {
            model: db.User,
            as: "user"
          },
        ],
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      let fee_payment_id = null;
      if (conversionFee) {
        await receiverAccount.increment({ balance: conversionFee }, { transaction });
        await receiverAccount.reload({ transaction });
        let fee_payment = await db.Payment.create({
          amount: conversionFee,
          fee: 0,
          memo: "Bitcoin conversion fee",
          account_id: receiverAccount.id,
          user_id: receiverAccount.user_id,
          rate: app.get("rates")[receiverAccount.user.currency],
          currency: receiverAccount.user.currency,
          confirmed: true,
          received: true,
          network: "COINOS"
        }, { transaction });
        fee_payment_id = fee_payment.id;
      }

      // record the external bitcoin transaction
      let params = {
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
        network: "bitcoin",
        fee_payment_id: fee_payment_id
      };

      if (config.bitcoin.walletpass)
        await bc.walletPassphrase(config.bitcoin.walletpass, 300);

      hex = (await bc.signRawTransactionWithWallet(hex)).hex;
      params.hash = await bc.sendRawTransaction(hex);

      let payment = await db.Payment.create(params, { transaction });

      payment = payment.get({ plain: true });
      payment.account = account.get({ plain: true });

      emit(user.username, "payment", payment);
      res.send(payment);

      payments.push(params.hash);
      l.info("sent bitcoin", user.username, total);
    });
  } catch (e) {
    if (e.message.includes("Insufficient")) e.message = "The coinos server hot wallet has insufficient funds to complete the payment, try again later";
    l.error("error sending bitcoin", e.message);
    console.log(e);
    return res.status(500).send(e.message);
  }
});
