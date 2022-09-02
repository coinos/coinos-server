import buildTx from '../../lib/buildliquidtx';

liquidTx = async ({ address, asset, amount, feeRate, replaceable, user }) => {
  let tx, fee;
  let node = lq;

  if (user.account.pubkey) {
    let psbt = await buildTx({
      address,
      asset,
      amount,
      feeRate,
      replaceable,
      user
    });
    return psbt;
  }

  let invoice = await db.Invoice.findOne({
    where: { address },
    include: {
      attributes: ["username"],
      model: db.User,
      as: "user"
    }
  });

  if (invoice) {
    let { ismine } = await node.getAddressInfo(address);
    if (ismine) {
      emit(user.username, "to", invoice.user);
      return;
    }
  }

  if (config.liquid.walletpass)
    await node.walletPassphrase(config.liquid.walletpass, 300);

  amount = parseInt(amount);

  let params = {
    subtractFeeFromOutputs: amount === user.balance ? [0] : []
  };

  let value = (amount / SATS).toFixed(8);
  if (feeRate) params.feeRate = (feeRate / SATS).toFixed(8);

  let info = await node.getAddressInfo(address);

  tx = await node.createRawTransaction(
    [],
    [{
      [address]: (amount / SATS).toFixed(8),
      asset
    }],
    0,
    replaceable,
  );

  l.info("funding tx for fee estimate", tx);

  tx = await node.fundRawTransaction(tx, params);

  let blinded = await node.blindRawTransaction(tx.hex);
  let signed = await node.signRawTransactionWithWallet(blinded);

  decoded = await node.decodeRawTransaction(signed.hex);
  feeRate = Math.round((tx.fee * SATS * 1000) / decoded.vsize);
  l.info("estimated", asset, feeRate);

  return { feeRate, tx };
};

export default ah(async (req, res) => {
  try {
    let tx = await liquidTx({ ...req.body, user: req.user })
    res.send(tx);
  } catch (e) {
    l.error("error estimating liquid fee", e.message, e.stack);
    return res.status(500).send(e.message);
  }
});
