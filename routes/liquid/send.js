const btc = config.liquid.btcasset;
const lcad = config.liquid.cadasset;
const { Transaction } = require("liquidjs-lib");
const { computeConversionFee, conversionFeeReceiver } = require('./conversionFee.js');

sendLiquid = async ({ asset, amount, user, address, memo, tx, limit }) => {
  try {
    l.info("sending liquid", amount, address);
    if (!tx) {
      ({ tx } = await liquidTx({
        address,
        asset,
        amount,
        feeRate: 200,
        replaceable: false,
        user
      }));
    }

    const isChange = async address =>
      (await lq.getAddressInfo(address)).ismine &&
      !Object.keys(addresses).includes(address);

    let totals = {};
    let change = {};
    let fee = 0;

    let { vout } = await lq.decodeRawTransaction(tx.hex);

    for (let i = 0; i < vout.length; i++) {
      let {
        asset,
        value,
        scriptPubKey: { type, addresses }
      } = vout[i];

      if (type === "fee") fee = toSats(value);
      else {
        if (!totals[asset]) totals[asset] = change[asset] = 0;
        totals[asset] += toSats(value);

        if (addresses) {
          if (await isChange(addresses[0])) {
            change[asset] += toSats(value);
          }
        }
      }
    }

    const assets = Object.keys(totals);
    const payments = [];

    let main, signed;
    await db.transaction(async transaction => {
      for (let i = 0; i < assets.length; i++) {
        let asset = assets[i];
        let amount = totals[asset];
        if (change[asset]) amount -= change[asset];
        let total = amount;

        if (asset === btc) {
          let covered = 0;
          let nonbtc = assets.filter(a => a !== btc);
          if (nonbtc.length === 1) {
            let faucet = await db.Account.findOne({
              where: {
                asset: nonbtc[0],
                user_id: null
              },
              lock: transaction.LOCK.UPDATE,
              transaction
            });

            if (faucet) {
              covered = faucet.balance;
              if (covered > fee) covered = fee;
              await faucet.decrement({ balance: covered }, { transaction });
              await faucet.reload({ transaction });
              await faucet.save({ transaction });
            }
          }

          total += fee - covered;
        }

        // get conversion fee
        // 'total' refers to the total before the conversion fee
        // (i.e. the total liquid bitcoin that leaves this server)
        var conversionFee = computeConversionFee(amount);

        if (limit && total > limit + fee)
          throw new Error("Tx amount exceeds authorized amount");

        if (asset !== btc || total) {
          l.info("creating liquid payment", user.username, asset, total, fee);

          let account = await db.Account.findOne({
            where: {
              user_id: user.id,
              asset,
              pubkey: null
            },
            lock: transaction.LOCK.UPDATE,
            order: [["balance", "DESC"]],
            transaction
          });

          // use user's credits to reduce fee, if available
          let conversionFeeDeduction = Math.min(account.liquid_credits, conversionFee);
          if (conversionFeeDeduction) {
            await account.decrement({ liquid_credits: conversionFeeDeduction }, { transaction });
            await account.reload({ transaction });
            conversionFee -= conversionFeeDeduction;
          }

          if (total > account.balance) {
            l.warn("amount exceeds balance", {
              total,
              fee,
              balance: account.balance
            });
            throw new Error(
              `Insufficient funds, need ${total} ${
                account.ticker === "BTC" ? "SAT" : account.ticker
              }, have ${account.balance}`
            );
          } else if (total + conversionFee > account.balance) {
            l.warn("amount plus conversion fee exceeds balance", {
              total,
              fee,
              conversionFee,
              balance: account.balance
            });
            throw new Error(
              `Insufficient funds, need ${total + conversionFee} ${
                account.ticker === "BTC" ? "SAT" : account.ticker
              }, have ${account.balance}`
            );
          }

          await account.decrement({ balance: (total + conversionFee)}, { transaction });
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
            let fee_payment = {
              amount: conversionFee,
              fee: 0,
              memo: "Liquid conversion fee",
              account_id: receiverAccount.id,
              user_id: receiverAccount.user_id,
              rate: app.get("rates")[receiverAccount.user.currency],
              currency: receiverAccount.user.currency,
              confirmed: true,
              received: true,
              network: "COINOS"
            };
            fee_payment.account = receiverAccount;
            payments.push(fee_payment);
            fee_payment_id = fee_payment.id;
          }

          let payment = {
            amount: -amount,
            account_id: account.id,
            fee,
            memo,
            user_id: user.id,
            rate: app.get("rates")[user.currency],
            currency: user.currency,
            address,
            confirmed: true,
            received: false,
            network: "liquid",
            fee_payment_id: fee_payment_id
          };

          payment.account = account;
          payments.push(payment);
        }
      }

      signed = await lq.signRawTransactionWithWallet(
        await lq.blindRawTransaction(tx.hex)
      );
      let txid = Transaction.fromHex(signed.hex).getId();

      for (let i = 0; i < assets.length; i++) {
        p = payments[i];
        if (p) {
          let { account } = p;
          p.hash = txid;
          p = await db.Payment.create(p, { transaction });
          if (account.ticker !== "BTC" || !main) {
            main = p.get({ plain: true });
            main.account = account.get({ plain: true });
          }
        }
      }

      emit(user.username, "account", main.account);
      emit(user.username, "payment", main);
    });

    if (config.liquid.walletpass)
      await lq.walletPassphrase(config.liquid.walletpass, 300);

    let txid = await lq.sendRawTransaction(signed.hex);
    l.info("sent liquid tx", txid, address);

    return main;
  } catch (e) {
    l.error("problem sending liquid", e.message);
  }
};

module.exports = ah(async (req, res) => {
  let { user } = req;

  try {
    res.send(await sendLiquid({ ...req.body, user }));
  } catch (e) {
    l.error("problem sending liquid", user.username, e.message);
    return res.status(500).send(e);
  }
});
