const bolt11 = require("bolt11");
const config = require("./config");

const l = require("pino")();

module.exports = (app, db, emit, seen, lna, lnb) => async (req, res) => {
  let hash = req.body.payreq;
  let payreq = bolt11.decode(hash);
  let { route } = req.body;
  let { user } = req;

 l.info("sending lightning", user.username, payreq.satoshis);

  if (seen.includes(hash)) {
    return res.status(500).send("Invoice has been paid, can't pay again");
  }

  try {
    await db.transaction(async transaction => {
      let { balance } = await db.User.findOne(
        {
          where: {
            username: user.username
          }
        },
        { transaction }
      );

      if (balance < payreq.satoshis) {
        throw new Error();
      }

      user.balance -= payreq.satoshis;
      await user.save({ transaction });
    });
  } catch (e) {
    return res.status(500).send("Not enough satoshis");
  }

  let m;
  try {
    let paymentHash = payreq.tags.find(t => t.tagName === 'payment_hash').data;
    m = lna.sendToRouteSync({
      "payment_hash": Buffer.from(paymentHash, 'hex'),
      route
    }, async function(err, m) {
      if (m.payment_error) return res.status(500).send(m.payment_error);
      if (seen.includes(m.payment_preimage)) return;
      seen.push(m.payment_preimage);

      let total = parseInt(m.payment_route.total_amt);
      let fee = m.payment_route.total_fees;

      user.balance -= total - payreq.satoshis;

      await db.transaction(async transaction => {
        await user.save({ transaction });

        const payment = await db.Payment.create(
          {
            amount: -total,
            fee,
            user_id: user.id,
            hash,
            rate: app.get("rates")[user.currency],
            currency: user.currency,
            confirmed: true,
            asset: 'LNBTC',
          },
          { transaction }
        );

        emit(user.username, "payment", payment);
        emit(user.username, "user", user);

        if (payreq.payeeNodeKey === config.lnb.id) {
          lna.addInvoice({ value: payreq.satoshis }, (err, invoice) => {
            let payback = lnb.sendPayment(lnb.meta, {});

            /* eslint-disable-next-line */
            let { payment_request } = invoice;
            /* eslint-disable-next-line */
            payback.write({ payment_request });
          });
        }

        seen.push(hash);
        res.send(payment);
      });
    });
  } catch (e) {
   l.info(e);
    return res.status(500).send(e);
  }
};
