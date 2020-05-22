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

    tx = await lq.createRawTransaction(
      [],
      {
        [address]: (amount / SATS).toFixed(8),
      },
      0,
      false,
      {
        [address]: asset,
      }
    );

    tx = await lq.fundRawTransaction(tx, params);

    /*
    let psbt;
    if (asset === config.liquid.btcasset) {
      psbt = await lq.convertToPsbt(tx.hex);
      let decoded = await lq.decodePsbt(psbt);

      let {
        tx: { vin, vout },
      } = decoded;

      let change, fee;
      for (let i = 0; i < vout.length; i++) {
        if (vout[i].scriptPubKey) {
          if (vout[i].scriptPubKey.type === "fee") fee = vout.splice(i, 1)[0];
          else if (
            !vout[i].scriptPubKey.addresses.includes(info.unconfidential)
          )
            change = vout[i];
        }
      }

      if (!change) {
        change = {
          value: 0,
          scriptPubKey: {
            addresses: [
              (await lq.getAddressInfo(await lq.getNewAddress()))
                .unconfidential,
            ],
          },
        };
      }

      psbt = await lq.createPsbt(
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
        ],
        0,
        false,
        {
          [address]: asset,
          [change.scriptPubKey.addresses[0]]: asset,
          fee: config.liquid.btcasset,
        }
      );
    }
    */

    let blinded = await lq.blindRawTransaction(tx.hex);
    let signed = await lq.signRawTransaction(blinded);

    decoded = await lq.decodeRawTransaction(signed.hex);
    feeRate = Math.round((tx.fee * SATS * 1000) / decoded.vsize);
    l.info("estimated", asset, feeRate);

    res.send({ feeRate, tx, /* psbt */ });
  } catch (e) {
    l.error("error estimating liquid fee", e.message);
    return res.status(500).send(e.message);
  }
};
