const axios = require("axios");
const uuidv4 = require("uuid/v4");

module.exports = ah(async (req, res, next) => {
  let { amount, asset, memo, username } = req.body;
  let { user } = req;

  if (!amount || amount < 0)
    return res.status(500).send("Amount must be greater than zero");

  try {
    await db.transaction(async (transaction) => {
      let account = await db.Account.findOne({
        where: {
          user_id: user.id,
          asset,
        },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });

      if (account.balance < amount) {
        throw new Error("Insufficient funds");
      }

      let fee = 0;

      account.balance -= amount;
      await account.save({ transaction });

      const params = {
        amount: -amount,
        account_id: account.id,
        memo,
        user_id: user.id,
        rate: app.get("rates")[user.currency],
        currency: user.currency,
        confirmed: true,
        hash: "Internal Transfer",
        network: "COINOS",
      };

      if (!username) {
        l.info("creating redeemable payment");
        params.redeemcode = uuidv4();
        params.hash = `${req.get('origin')}/redeem/${params.redeemcode}`;
      }

      let payment = await db.Payment.create(params, { transaction });

      payment = payment.get({ plain: true });
      payment.account = account.get({ plain: true });

      l.info("sent internal", user.username, -payment.amount);

      emit(user.username, "payment", payment);
      emit(user.username, "account", account);
      emit(user.username, "user", user);
      res.send(payment);

      if (username) {
        user = await db.User.findOne({
          where: { username },
        });


        const invoice = await db.Invoice.findOne({
          where: {
            user_id: user.id,
            network: "BTC"
          },
          order: [["id", "DESC"]],
          include: {
            model: db.Account,
            as: "account",
          },
        });

        if (invoice) ({ account } = invoice);
        else if (user.account.asset === asset) ({ account } = user);
        else {

        let params = {
          user_id: user.id,
          asset,
        };

        account = await db.Account.findOne({
          where: params,
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        }

        if (account) {
          account.balance += amount;
          await account.save({ transaction });
        } else {
          let name = asset.substr(0, 6);
          let domain;
          let ticker = asset.substr(0, 3).toUpperCase();
          let precision = 8;

          const assets = (await axios.get("https://assets.blockstream.info/"))
            .data;

          if (assets[asset]) {
            ({ domain, ticker, precision, name } = assets[asset]);
          } else {
            const existing = await db.Account.findOne({
              where: {
                asset,
              },
              order: [["id", "ASC"]],
              limit: 1,
            });

            l.info("existing", existing);

            if (existing) {
              ({ domain, ticker, precision, name } = existing);
            }
          }

          params = { ...params, ...{ domain, ticker, precision, name } };
          params.balance = amount;
          params.pending = 0;
          account = await db.Account.create(params, { transaction });
        }

        payment = await db.Payment.create(
          {
            amount,
            account_id: account.id,
            user_id: user.id,
            rate: app.get("rates")[user.currency],
            currency: user.currency,
            confirmed: true,
            hash: "Internal Transfer",
            memo,
            network: "COINOS",
            received: true,
          },
          { transaction }
        );

        payment = payment.get({ plain: true });
        payment.account = account.get({ plain: true });
        emit(user.username, "account", account);
        emit(user.username, "payment", payment);

        l.info("received internal", user.username, amount);
        notify(user, `Received ${amount} ${account.ticker} sats`);
      }
    });
  } catch (e) {
    l.error(
      "problem sending internal payment",
      user.username,
      user.balance,
      e.message
    );
    return res.status(500).send(e.message);
  }
});
