module.exports = async (req, res) => {
  let { user } = req;
  let { address, amount, feeRate } = req.body;
  let tx, fee;

  try {
    amount = parseInt(amount);

    tx = await lq.createRawTransaction([], {
      [address]: (amount / SATS).toFixed(8)
    });

    let params = {
      subtractFeeFromOutputs: amount === user.balance ? [0] : []
    } 

    if (feeRate) params.feeRate = (feeRate / SATS).toFixed(8);

    tx = await lq.fundRawTransaction(tx, params);

    if (config.liquid.walletpass)
      await lq.walletPassphrase(config.liquid.walletpass, 300);

    let signed = (await lq.signRawTransactionWithWallet(tx.hex));
    decoded = await lq.decodeRawTransaction(signed.hex);
    feeRate = parseInt(tx.fee * SATS * 1000 / decoded.vsize);

    res.send({ feeRate, tx });
  } catch (e) {
    l.error("error estimating liquid fee", e);
    return res.status(500).send(e.message);
  }
};
