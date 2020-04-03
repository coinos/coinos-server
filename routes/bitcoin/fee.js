module.exports = async (req, res) => {
  let { user } = req;
  let { address, amount, feeRate } = req.body;
  let tx, fee;

  try {
    amount = parseInt(amount);

    tx = await bc.createRawTransaction([], {
      [address]: (amount / SATS).toFixed(8)
    });

    let params = {
      subtractFeeFromOutputs: amount === user.balance ? [0] : []
    } 

    if (feeRate) params["feeRate"] = (feeRate / SATS * 1000).toFixed(8);

    tx = await bc.fundRawTransaction(tx, params);
    let decoded = await bc.decodeRawTransaction(tx.hex);
    /* TODO: figure out why this 0.8 multiplier seems necessary */
    feeRate = (tx.fee * SATS / decoded.vsize) * 1000 * 0.80145;
    res.send({ feeRate, tx });
  } catch (e) {
    l.error("bitcoin fee estimation error", e);
    return res.status(500).send(e.message);
  }
};
