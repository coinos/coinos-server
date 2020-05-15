module.exports = async (req, res) => {
  let { user } = req;
  let { address, amount, feeRate } = req.body;
  let tx, fee;

  let recipient = await db.User.findOne({
    where: { address }
  });

  if (recipient) {
    l.info("emitting");
    emit(user.username, "to", recipient);
  }

  try {
    amount = parseInt(amount);

    let partial = await bc.createRawTransaction([], {
      [address]: (amount / SATS).toFixed(8)
    });

    let params = {
      subtractFeeFromOutputs: amount === user.balance ? [0] : []
    } 

    if (feeRate) params.feeRate = (feeRate / SATS).toFixed(8);

    tx = await bc.fundRawTransaction(partial, params);

    if (config.bitcoin.walletpass)
      await bc.walletPassphrase(config.bitcoin.walletpass, 300);

    let signed = (await bc.signRawTransactionWithWallet(tx.hex));
    decoded = await bc.decodeRawTransaction(signed.hex);
    feeRate = Math.round(tx.fee * SATS * 1000 / decoded.vsize);
    
    res.send({ feeRate, tx });
  } catch (e) {
    l.error("bitcoin fee estimation error", e);
    return res.status(500).send(e.message);
  }
};
