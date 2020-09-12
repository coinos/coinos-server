const buildTx = require("../../lib/buildliquidtx");

module.exports = ah(async (req, res) => {
  let { user } = req;
  let { address, asset, amount, feeRate, replaceable } = req.body;
  let tx, fee;

  if (user.account.pubkey) {
    try {
      let psbt = await buildTx({
        address,
        asset,
        amount,
        feeRate,
        replaceable,
        user
      });
      return res.send(psbt);
    } catch (e) {
      return res.status(500).send(e.message);
    }
  }

  let invoice = await db.Invoice.findOne({
    where: { address },
    include: {
      attributes: ["username"],
      model: db.User,
      as: "user"
    }
  });

  if (invoice) {
    let { ismine } = await lq.getAddressInfo(address);
    if (ismine) {
      emit(user.username, "to", invoice.user);
      return res.end();
    }
  }

  try {
    if (config.liquid.walletpass)
      await lq.walletPassphrase(config.liquid.walletpass, 300);

    amount = parseInt(amount);

    let params = {
      subtractFeeFromOutputs: amount === user.balance ? [0] : []
    };

    let value = (amount / SATS).toFixed(8);
    if (feeRate) params.feeRate = (feeRate / SATS).toFixed(8);

    let info = await lq.getAddressInfo(address);

    tx = await lq.createRawTransaction(
      [],
      {
        [address]: (amount / SATS).toFixed(8)
      },
      0,
      replaceable,
      {
        [address]: asset
      }
    );

    tx = await lq.fundRawTransaction(tx, params);

    let blinded = await lq.blindRawTransaction(tx.hex);
    let signed = await lq.signRawTransactionWithWallet(blinded);

    decoded = await lq.decodeRawTransaction(signed.hex);
    feeRate = Math.round((tx.fee * SATS * 1000) / decoded.vsize);
    l.info("estimated", asset, feeRate);

    res.send({ feeRate, tx });
  } catch (e) {
    l.error("error estimating liquid fee", e.message);
    return res.status(500).send(e.message);
  }
});
