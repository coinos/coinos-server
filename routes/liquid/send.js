import store from "$lib/store.js";
import config from "$config/index.js";
const btc = config.liquid.btcasset;
const lcad = config.liquid.cadasset;
// import { Transaction } from 'liquidjs-lib';
import {
  computeConversionFee,
  conversionFeeReceiver
} from "./conversionFee.js";

export const sendLiquid = async ({ asset, amount, user, address, memo, tx, limit }) => {
  try {
    l("sending liquid", amount, address);
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
      !Object.keys(store.addresses).includes(address);

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
      let fee_payment;
      let fee_payment_id = null;

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

        var conversionFee = computeConversionFee(amount);

        if (limit && total > limit + fee)
          throw new Error("Tx amount exceeds authorized amount");

        if (asset !== btc || total) {
          l("creating liquid payment", user.username, asset, total, fee);

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
          let conversionFeeDeduction = Math.min(
            account.liquid_credits,
            conversionFee
          );
          if (conversionFeeDeduction) {
            await account.decrement(
              { liquid_credits: conversionFeeDeduction },
              { transaction }
            );
            await account.reload({ transaction });
            conversionFee -= conversionFeeDeduction;
          }

          if (asset !== btc) conversionFee = 0;

          if (total > account.balance) {
            warn("amount exceeds balance", {
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
            warn("amount plus conversion fee exceeds balance", {
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

          await account.decrement(
            { balance: total + conversionFee },
            { transaction }
          );
          await account.reload({ transaction });

          let receiverAccount = await db.Account.findOne({
            where: {
              "$user.username$": conversionFeeReceiver
            },
            include: [
              {
                model: db.User,
                as: "user"
              }
            ],
            lock: transaction.LOCK.UPDATE,
            transaction
          });

          if (conversionFee) {
            await receiverAccount.increment(
              { balance: conversionFee },
              { transaction }
            );
            await receiverAccount.reload({ transaction });
            fee_payment = {
              amount: conversionFee,
              fee: 0,
              memo: "Liquid conversion fee",
              account_id: receiverAccount.id,
              user_id: receiverAccount.user_id,
              rate: store.rates[receiverAccount.user.currency],
              currency: receiverAccount.user.currency,
              confirmed: true,
              received: true,
              network: "COINOS"
            };
            fee_payment.account = receiverAccount;
            ({ id: fee_payment_id } = await db.Payment.create(fee_payment, {
              transaction
            }));
          }

          let payment = {
            amount: -amount,
            account_id: account.id,
            fee,
            memo,
            user_id: user.id,
            rate: store.rates[user.currency],
            currency: user.currency,
            address,
            confirmed: true,
            received: false,
            network: "liquid",
            fee_payment_id
          };

          payment.account = account;
          payments.push(payment);
        }
      }

      signed = await lq.signRawTransactionWithWallet(
        await lq.blindRawTransaction(tx.hex)
      );
      let txid = Transaction.fromHex(signed.hex).getId();

      for (let i = 0; i < payments.length; i++) {
        p = payments[i];
        if (p) {
          let { account } = p;
          p.hash = txid;
          p = await db.Payment.create(p, { transaction });
          if (p.user_id === user.id && (account.ticker !== "BTC" || !main)) {
            main = p.get({ plain: true });
            main.fee_payment = fee_payment;
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
    l("sent liquid tx", txid, address);

    return main;
  } catch (e) {
    err("problem sending liquid", e.message);
  }
};

export default async (req, res) => {
  let { user } = req;

  try {
    res.send(await sendLiquid({ ...req.body, user }));
  } catch (e) {
    err("problem sending liquid", user.username, e.message);
    return res.status(500).send(e);
  }
};
