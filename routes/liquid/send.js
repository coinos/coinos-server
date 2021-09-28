const btc = config.liquid.btcasset;
const lcad = config.liquid.cadasset;
const { Transaction } = require("@asoltys/liquidjs-lib");
const decrementAccount = require('./util/decrementacc');

sendLiquid = async ({ asset, amount, user, address, memo, tx, limit }) => {
  l.info("sending liquid", amount, address);
  if (!tx) {
    ({ tx } = await liquidTx({
      address,
      asset,
      amount,
      feeRate: 100,
      replaceable: false,
      user
    }));
  }

  const isChange = async address =>
    (await lq.getAddressInfo(address)).ismine &&
    !Object.keys(addresses).includes(address);

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
    for (let i = 0; i < assets.length; i++) {
      let asset = assets[i];
      let amount = totals[asset];
      if (change[asset]) amount -= change[asset];

      const payment = await decrementAccount(user, transaction, limit, fee, assets, amount, address, memo, asset);
      if(payment) {
        payments.push(payment);
      }
    }

    signed = await lq.signRawTransactionWithWallet(
      await lq.blindRawTransaction(tx.hex)
    );
    let txid = Transaction.fromHex(signed.hex).getId();

    for (let i = 0; i < assets.length; i++) {
      p = payments[i];
      if (p) {
        let { account } = p;
        p.hash = txid;
        p = await db.Payment.create(p, { transaction });
        if (account.ticker !== "BTC" || !main) {
          main = p.get({ plain: true });
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
  l.info("sent liquid tx", txid, address);

  return main;
};

module.exports = ah(async (req, res) => {
  let { user } = req;

  try {
    res.send(await sendLiquid({ ...req.body, user }));
  } catch (e) {
    l.error("problem sending liquid", user.username, e.message);
    return res.status(500).send(e);
  }
});
