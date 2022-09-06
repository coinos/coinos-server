import { emit } from "$lib/sockets";
import store from "$lib/store";
import { callWebhook } from "$lib/webhooks";
import axios from "axios";
import { v4 } from "uuid";
import { notify } from "$lib/notifications";
import { sendLiquid } from "$routes/liquid/send";

export default async (req, res, next) => {
  let {
    amount,
    address,
    payreq,
    unconfidential,
    asset,
    memo,
    username
  } = req.body;
  let { user } = req;
  amount = parseInt(amount);

  if (!asset) asset = config.liquid.btcasset;

  if (!amount || amount < 0)
    return res.code(500).send("Amount must be greater than zero");

  try {
    await db.transaction(async transaction => {
      let account;
      if (user.account.asset === asset) {
        account = await db.Account.findOne({
          where: {
            id: user.account.id,
            pubkey: null
          },
          lock: transaction.LOCK.UPDATE,
          transaction
        });
      } else {
        account = await db.Account.findOne({
          where: {
            user_id: user.id,
            asset,
            pubkey: null
          },
          lock: transaction.LOCK.UPDATE,
          transaction
        });
      }

      if (account.balance < amount) {
        throw new Error("Insufficient funds");
      }

      let fee = 0;

      await account.decrement({ balance: amount }, { transaction });
      await account.reload({ transaction });

      let params = {
        amount: -amount,
        account_id: account.id,
        memo,
        user_id: user.id,
        rate: store.rates[user.currency],
        currency: user.currency,
        confirmed: true,
        hash: `#${v4().substr(0, 6)} ${
          username ? `Payment to ${username}` : "Internal Transfer"
        }`,
        network: "COINOS"
      };

      if (!username) {
        l("creating redeemable payment");
        params.redeemcode = v4();
        params.hash = `${req.get("origin")}/redeem/${params.redeemcode}`;
      }

      let payment = await db.Payment.create(params, { transaction });

      payment = payment.get({ plain: true });
      payment.account = account.get({ plain: true });

      l("sent internal", user.username, -payment.amount);

      emit(user.username, "payment", payment);
      emit(user.username, "account", account);

      if (username) {
        let recipient = await db.User.findOne(
          {
            where: { username },
            include: {
              model: db.Account,
              as: "account"
            }
          },
          { transaction }
        );

        params = {
          where: { user_id: recipient.id },
          order: [["id", "DESC"]]
        };
        if (address) params.where.address = address;
        else if (payreq) params.where.text = payreq;
        let invoice = (address || payreq) && (await db.Invoice.findOne(params));

        let a2;
        let acc = {
          user_id: recipient.id,
          asset,
          pubkey: null
        };

        if (recipient.account.asset === asset && !recipient.account.pubkey)
          a2 = recipient.account;
        else {
          a2 = await db.Account.findOne({
            where: acc,
            lock: transaction.LOCK.UPDATE,
            transaction
          });
        }

        if (a2) {
          await a2.increment({ balance: amount }, { transaction });
          await a2.reload({ transaction });
        } else {
          let name = asset.substr(0, 6);
          let domain;
          let ticker = asset.substr(0, 3).toUpperCase();
          let precision = 8;

          if (store.assets[asset]) {
            ({ domain, ticker, precision, name } = store.assets[asset]);
          } else {
            const existing = await db.Account.findOne({
              where: {
                asset
              },
              order: [["id", "ASC"]],
              limit: 1,
              lock: transaction.LOCK.UPDATE,
              transaction
            });

            if (existing) {
              ({ domain, ticker, precision, name } = existing);
            }
          }

          acc = { ...acc, ...{ domain, ticker, precision, name } };
          acc.balance = amount;
          acc.pending = 0;
          acc.network = "liquid";
          a2 = await db.Account.create(acc, { transaction });
        }

        let spread = user.username === "coinos" ? 1.02 : 1;
        amount = Math.round(amount / spread);

        params = {
          amount,
          account_id: a2.id,
          user_id: recipient.id,
          rate: store.rates[recipient.currency] * spread,
          currency: recipient.currency,
          confirmed: true,
          hash: `#${v4().substr(0, 6)} Payment from ${user.username}`,
          memo,
          network: "COINOS",
          received: true
        };

        if (invoice) {
          params.invoice_id = invoice.id;

          let c = convert[invoice.text];
          if (c) {
            l(
              "internal payment detected for conversion",
              invoice.text,
              c.address,
              recipient.username
            );

            recipient.account = a2;

            sendLiquid({
              address: c.address,
              amount: amount - 100,
              user: recipient,
              limit: amount
            }).catch(console.log);
          }
        }

        let p2 = await db.Payment.create(params, { transaction });

        p2 = p2.get({ plain: true });
        p2.account = a2.get({ plain: true });
        emit(recipient.username, "payment", p2);
        emit(recipient.username, "account", p2.account);

        l("received internal", recipient.username, amount);
        notify(recipient, `Received ${amount} ${a2.ticker} sats`);
        callWebhook(invoice, p2);
      }
      res.send(payment);
    });
  } catch (e) {
    console.log(e);
    err("problem sending internal payment", user.username, e.message);
    return res.code(500).send(e.message);
  }
};
