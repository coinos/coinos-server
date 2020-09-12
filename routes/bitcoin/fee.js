const buildTx = require("../../lib/buildtx");

module.exports = ah(async (req, res) => {
  let { user } = req;
  let { address, amount, feeRate, replaceable } = req.body;
  let tx, fee;

  if (user.account.pubkey) {
    try {
      let psbt = await buildTx({ address, amount, feeRate, replaceable, user });
      return res.send(psbt);
    } catch(e) {
      return res.status(500).send(e.message);
    } 
  }

  let invoice = await db.Invoice.findOne({
    where: { address },
    include: {
      attributes: ["username"],
      model: db.User,
      as: "user",
    },
  });

  if (invoice) {
    let { ismine } = await bc.getAddressInfo(address);
    if (ismine) {
      emit(user.username, "to", invoice.user);
      return res.end();
    }
  }

  try {
    amount = parseInt(amount);

    let partial = await bc.createRawTransaction([], {
      [address]: (amount / SATS).toFixed(8),
    }, 0, replaceable);

    let params = {
      subtractFeeFromOutputs: amount === user.balance ? [0] : [],
      replaceable,
    };

    if (feeRate) params.feeRate = (feeRate / SATS).toFixed(8);

    tx = await bc.fundRawTransaction(partial, params);

    if (config.bitcoin.walletpass)
      await bc.walletPassphrase(config.bitcoin.walletpass, 300);

    let signed = await bc.signRawTransactionWithWallet(tx.hex);
    decoded = await bc.decodeRawTransaction(signed.hex);
    feeRate = Math.round((tx.fee * SATS * 1000) / decoded.vsize);

    res.send({ feeRate, tx });
  } catch (e) {
    l.error("bitcoin fee estimation error", e);
    return res.status(500).send(e.message);
  }
});
