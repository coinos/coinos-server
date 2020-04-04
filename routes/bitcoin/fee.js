module.exports = async (req, res) => {
  let { user } = req;
  let { address, amount, feeRate } = req.body;
  let tx, fee;

  try {
    amount = parseInt(amount);

    let unsigned = await bc.createRawTransaction([], {
      [address]: (amount / SATS).toFixed(8)
    });

    let params = {
      subtractFeeFromOutputs: amount === user.balance ? [0] : []
    } 

    if (feeRate) params.feeRate = (feeRate / SATS).toFixed(8);
    l.info("requested rate", params.feeRate * SATS);

    let decoded = await bc.decodeRawTransaction(unsigned);
    let { weight, size, vsize } = decoded;

    tx = await bc.fundRawTransaction(unsigned, params);
    feeRate = parseInt(tx.fee * SATS * 1000 / decoded.size);
    l.info("unsigned", { weight, size, vsize, feeRate });

    decoded = await bc.decodeRawTransaction(tx.hex);
    feeRate = parseInt(tx.fee * SATS * 1000 / decoded.size);
    ({ weight, size, vsize } = decoded)
    l.info("signed", { weight, size, vsize, feeRate });

    
    res.send({ feeRate, unsigned, tx });
  } catch (e) {
    l.error("bitcoin fee estimation error", e);
    return res.status(500).send(e.message);
  }
};
