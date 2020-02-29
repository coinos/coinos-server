const bolt11 = require("bolt11");
const config = require("./config");

const l = console.log;

var fs = require('fs');
var grpc = require('grpc');
var lnrpc = grpc.load('/root/grpc/rpc.proto').lnrpc;
process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA'
var lndCert = fs.readFileSync('/root/.lnda/tls.cert');
var sslCreds = grpc.credentials.createSsl(lndCert);
var macaroonCreds = grpc.credentials.createFromMetadataGenerator(function(args, callback) {
    var macaroon = fs.readFileSync("/root/.lnda/data/chain/bitcoin/mainnet/admin.macaroon").toString('hex');
    var metadata = new grpc.Metadata()
    metadata.add('macaroon', macaroon);
    callback(null, metadata);
  });
var creds = grpc.credentials.combineChannelCredentials(sslCreds, macaroonCreds);
var lightning = new lnrpc.Lightning('localhost:10001', creds);

module.exports = (app, db, emit, seen, lna, lnb) => async (req, res) => {
  let hash = req.body.payreq;
  let payreq = bolt11.decode(hash);
  let { route } = req.body;
  let { user } = req;

  l("sending lightning", user.username, payreq.satoshis);

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
    m = lightning.sendToRouteSync({
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
          let invoice = await lna.addInvoice({ value: payreq.satoshis });
          let payback = lnb.sendPayment(lnb.meta, {});

          /* eslint-disable-next-line */
          let { payment_request } = invoice;
          /* eslint-disable-next-line */
          payback.write({ payment_request });
        }

        seen.push(hash);
        res.send(payment);
      });
    });
  } catch (e) {
    l(e);
    return res.status(500).send(e);
  }
};
