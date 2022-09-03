import store from "../../lib/store.js";
export default async (req, res) => {
  try {
    const { user } = req;
    let hash = await lq.sendRawTransaction(req.body.tx);

    if (user) {
      await db.transaction(async transaction => {
        let account = await db.Account.findOne({
          where: {
            id: user.account_id
          },
          lock: transaction.LOCK.UPDATE,
          transaction
        });

        let payment = await db.Payment.create(
          {
            ...req.body.payment,
            hash,
            amount: -req.body.payment.amount,
            tip: 0,
            account_id: account.id,
            user_id: user.id,
            rate: store.rates[user.currency],
            currency: user.currency,
            confirmed: true,
            received: false,
            network: "liquid"
          },
          { transaction }
        );

        await account.increment(
          { balance: payment.amount - payment.fee },
          { transaction }
        );
        await account.reload({ transaction });

        payment = payment.get({ plain: true });
        payment.account = account.get({ plain: true });
        emit(user.username, "payment", payment);
        emit(user.username, "account", payment.account);
        res.send(payment);
      });
    } else {
      res.send(hash);
    }
  } catch (e) {
    err("problem broadcasting liquid transaction", e);
    res.status(500).send(e.message);
  }
};
