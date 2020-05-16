const axios = require("axios");

module.exports = async (req, res) => {
  let { amount, asset, username } = req.body;
  let { user } = req;

  l.info("attempting internal payment", user.username, amount);
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

      let payment = await db.Payment.create(
        {
          amount: -amount,
          account_id: account.id,
          user_id: user.id,
          rate: app.get("rates")[user.currency],
          currency: user.currency,
          confirmed: true,
          hash: "Internal Transfer",
          network: "COINOS",
        },
        { transaction }
      );

      payment = payment.get({ plain: true });
      payment.account = account.get({ plain: true });

      l.info("sent internal", user.username, -payment.amount);

      user = await getUser(user.username, transaction);
      emit(user.username, "user", user);
      res.send(payment);

      user = await db.User.findOne({
        where: { username },
      });

      let params = {
        user_id: user.id,
        asset,
      };

      account = await db.Account.findOne({
        where: params,
        lock: transaction.LOCK.UPDATE,
        transaction,
      });

      if (account) {
        account.balance += amount;
        await account.save({ transaction });
      } else {
        let name = asset.substr(0, 6);
        let ticker = asset.substr(0, 3).toUpperCase();
        let precision = 8;

        const assets = (await axios.get("https://assets.blockstream.info/"))
          .data;

        if (assets[asset]) {
          ({ ticker, precision, name } = assets[asset]);
        }

        params = { ...params, ...{ ticker, precision, name } };
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
          network: "COINOS",
          received: true,
        },
        { transaction }
      );

      user = await getUser(user.username, transaction);
      emit(user.username, "user", user);

      payment = payment.get({ plain: true });
      payment.account = account.get({ plain: true });
      emit(user.username, "payment", payment);

      l.info("received internal", user.username, payment.amount);
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
};
