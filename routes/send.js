const axios = require("axios");
const uuidv4 = require("uuid/v4");

module.exports = ah(async (req, res, next) => {
  let { amount, asset, memo, username } = req.body;
  let { user } = req;

  if (!amount || amount < 0)
    return res.status(500).send("Amount must be greater than zero");

  try {
    await db.transaction(async transaction => {
      let { account } = user;

      if (account.balance < amount) {
        throw new Error("Insufficient funds");
      }

      let fee = 0;

      account.balance -= amount;
      await account.save({ transaction });

      let params = {
        amount: -amount,
        account_id: account.id,
        memo,
        user_id: user.id,
        rate: app.get("rates")[user.currency],
        currency: user.currency,
        confirmed: true,
        hash: "Internal Transfer",
        network: "COINOS"
      };

      if (!username) {
        l.info("creating redeemable payment");
        params.redeemcode = uuidv4();
        params.hash = `${req.get("origin")}/redeem/${params.redeemcode}`;
      }

      let payment = await db.Payment.create(params, { transaction });

      payment = payment.get({ plain: true });
      payment.account = account.get({ plain: true });

      l.info("sent internal", user.username, -payment.amount);

      emit(user.username, "payment", payment);
      emit(user.username, "account", account);
      emit(user.username, "user", user);

      if (username) {
        let recipient = await db.User.findOne({
          where: { username },
          include: {
            model: db.Account,
            as: "account"
          }
        },
          { transaction });

        let a2;
        let acc = {
          user_id: recipient.id,
          asset,
          pubkey: null
        };

        if (recipient.account.asset === asset && !recipient.account.pubkey)
          ({ account: a2 } = recipient);
        else {
          a2 = await db.Account.findOne({
            where: acc,
          }, { transaction });
        }

        if (a2) {
          a2.balance += amount;
          await a2.save({ transaction });
        } else {
          let name = asset.substr(0, 6);
          let domain;
          let ticker = asset.substr(0, 3).toUpperCase();
          let precision = 8;

          const assets = app.get('assets');

          if (assets[asset]) {
            ({ domain, ticker, precision, name } = assets[asset]);
          } else {
            const existing = await db.Account.findOne({
              where: {
                asset
              },
              order: [["id", "ASC"]],
              limit: 1
            }, { transaction });

            if (existing) {
              ({ domain, ticker, precision, name } = existing);
            }
          }

          acc = { ...acc, ...{ domain, ticker, precision, name } };
          acc.balance = amount;
          acc.pending = 0;
          acc.network = 'liquid';
          a2 = await db.Account.create(acc, { transaction });
        }

        let p2 = await db.Payment.create(
          {
            amount,
            account_id: a2.id,
            user_id: recipient.id,
            rate: app.get("rates")[recipient.currency],
            currency: recipient.currency,
            confirmed: true,
            hash: "Internal Transfer",
            memo,
            network: "COINOS",
            received: true
          },
          { transaction }
        );

        p2 = p2.get({ plain: true });
        p2.account = a2.get({ plain: true });
        emit(recipient.username, "account", p2.account);
        emit(recipient.username, "payment", p2);

        l.info("received internal", recipient.username, amount);
        notify(recipient, `Received ${amount} ${a2.ticker} sats`);
      }
      res.send(payment);
    });
  } catch (e) {
    l.error(
      "problem sending internal payment",
      user.username,
      user.balance,
      e.message,
    );
    return res.status(500).send(e.message);
  }
});
