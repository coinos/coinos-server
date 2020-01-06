const bolt11 = require("bolt11");
const config = require("./config");

const l = console.log;

module.exports = (app, db, emit, seen, lna, lnb) => async (req, res) => {
  let hash = req.body.payreq;
  let payreq = bolt11.decode(hash);
  l("sending lightning", req.user.username, payreq.satoshis);

  if (seen.includes(hash)) {
    return res.status(500).send("Invoice has been paid, can't pay again");
  }

  try {
    await db.transaction(async transaction => {
      let { balance } = await db.User.findOne(
        {
          where: {
            username: req.user.username
          }
        },
        { transaction }
      );

      if (balance < payreq.satoshis) {
        throw new Error();
      }

      req.user.balance -= payreq.satoshis;
      await req.user.save({ transaction });
    });
  } catch (e) {
    return res.status(500).send("Not enough satoshis");
  }

  const stream = lna.sendPayment(lna.meta, {});
  stream.write({ payment_request: req.body.payreq });

  stream.on("data", async m => {
    if (m.payment_error) {
      res.status(500).send(m.payment_error);
    } else {
      if (seen.includes(m.payment_preimage)) return;
      seen.push(m.payment_preimage);

      let total = parseInt(m.payment_route.total_amt);
      req.user.balance -= total - payreq.satoshis;

      await db.transaction(async transaction => {
        await req.user.save({ transaction });

        await db.Payment.create(
          {
            amount: -total,
            user_id: req.user.id,
            hash,
            rate: app.get("ask"),
            currency: "CAD",
            confirmed: true
          },
          { transaction }
        );
      });

      emit(req.user.username, "user", req.user);

      if (payreq.payeeNodeKey === config.lnb.id) {
        let invoice = await lna.addInvoice({ value: payreq.satoshis });
        let payback = lnb.sendPayment(lnb.meta, {});

        /* eslint-disable-next-line */
        let { payment_request } = invoice;
        /* eslint-disable-next-line */
        payback.write({ payment_request });
      }

      seen.push(hash);
      res.send(m);
    }
  });

  stream.on("error", e => {
    let msg = e.message;

    res.status(500).send(msg);
  });
};
