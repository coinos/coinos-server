import { emit } from "$lib/sockets";
import store from "$lib/store";
import { requirePin } from "$lib/utils";

export default async (req, res) => {
  try {
    await requirePin(req);

    const { user } = req;
    let hash = await bc.sendRawTransaction(req.body.tx);

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
            network: "bitcoin"
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
      res.send(result);
    }
  } catch (e) {
    res.code(500).send(e.message);
  }
};
