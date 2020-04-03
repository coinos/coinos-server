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

    if (feeRate) params["feeRate"] = (feeRate / SATS * 1000).toFixed(8);

    tx = await lq.fundRawTransaction(tx, params);
    let decoded = await lq.decodeRawTransaction(tx.hex);
    /* TODO: figure out why this multiplier seems necessary */
    feeRate = (tx.fee * SATS / decoded.size) * 1000 * 0.137685;
    l.info(decoded.weight, decoded.size, decoded.vsize, feeRate);
    res.send({ feeRate, tx });
  } catch (e) {
    l.error("error estimating liquid fee", e);
    return res.status(500).send(e.message);
  }
};
