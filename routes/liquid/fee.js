module.exports = async (req, res) => {
  let { user } = req;
  let { address, asset, amount, feeRate } = req.body;
  let tx, fee;

  let recipient = await db.User.findOne({
    attributes: ["username"],
    where: { confidential: address },
  });

  if (recipient) emit(user.username, "to", recipient);

  try {
    if (config.liquid.walletpass)
      await lq.walletPassphrase(config.liquid.walletpass, 300);

    amount = parseInt(amount);

    let params = {
      subtractFeeFromOutputs: amount === user.balance ? [0] : [],
    };

    let value = (amount / SATS).toFixed(8);
    if (feeRate) params.feeRate = (feeRate / SATS).toFixed(8);

    let info = await lq.getAddressInfo(address);

    tx = await lq.walletCreateFundedPsbt(
      [],
      {
        [address]: value,
      },
      0,
      params
    );

    let decoded = await lq.decodePsbt(tx.psbt);

    let {
      tx: { vin, vout },
    } = decoded;

    let change, fee;
    for (let i = 0; i < vout.length; i++) {
      if (vout[i].scriptPubKey) {
        if (vout[i].scriptPubKey.type === "fee") fee = vout.splice(i, 1)[0];
        else if (!vout[i].scriptPubKey.addresses.includes(info.unconfidential))
          change = vout[i];
      }
    }

    let psbt = await lq.createPsbt(
      vin.map((input) => ({
        txid: input.txid,
        vout: input.vout,
        sequence: input.sequence,
      })),
      [
        {
          [change.scriptPubKey.addresses[0]]: (
            change.value + fee.value
          ).toFixed(8),
        },
        { [address]: value },
      ]
    );

    let blinded = await lq.blindPsbt(tx.psbt);
    let signed = await lq.walletSignPsbt(blinded);

    decoded = await lq.decodePsbt(signed.psbt);
    feeRate = Math.round((decoded.fees * SATS * 1000) / decoded.vsize);
    l.info("estimated", asset, feeRate );

    res.send({ feeRate, tx, psbt });
  } catch (e) {
    l.error("error estimating liquid fee", e.message);
    return res.status(500).send(e.message);
  }
};
