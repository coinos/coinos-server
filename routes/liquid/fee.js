module.exports = async (req, res) => {
  let { user } = req;
  let { address, asset, amount, feeRate } = req.body;
  let tx, fee;

  try {
    amount = parseInt(amount);

    tx = await lq.createRawTransaction(
      [],
      {
        [address]: (amount / SATS).toFixed(8)
      },
      0,
      false,
      {
        [address]: asset
      }
    );

    let params = {
      subtractFeeFromOutputs: amount === user.balance ? [0] : []
    };

    if (feeRate) params.feeRate = (feeRate / SATS).toFixed(8);

    tx = await lq.fundRawTransaction(tx, params);

    if (config.liquid.walletpass)
      await lq.walletPassphrase(config.liquid.walletpass, 300);

    let blinded = await lq.blindRawTransaction(tx.hex);
    let signed = await lq.signRawTransactionWithWallet(blinded);
    decoded = await lq.decodeRawTransaction(signed.hex);
    feeRate = Math.round((tx.fee * SATS * 1000) / decoded.vsize);

    res.send({ feeRate, tx });
  } catch (e) {
    l.error("error estimating liquid fee", e);
    return res.status(500).send(e.message);
  }
};
