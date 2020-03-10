const config = require("./config");

const l = require("pino")();
const SATS = 100000000;

module.exports = (app, bc, db, emit) => async (req, res) => {
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

    if (feeRate) params["feeRate"] = (parseInt(feeRate) / SATS * 1000).toFixed(8);

    tx = await bc.fundRawTransaction(tx, params);
    res.send({ tx });
  } catch (e) {
    l.error(e);
    return res.status(500).send(e.message);
  }
};
