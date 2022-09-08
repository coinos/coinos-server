import config from "$config";
import db from "$db";
import { emit } from "$lib/sockets";
import buildTx from "$lib/buildliquidtx";
import { err, l } from "$lib/logging";
import { SATS } from "$lib/utils";
import lq from "$lib/liquid";

export const liquidTx = async ({ address, asset, amount, feeRate, replaceable, user }) => {
  let tx, fee;

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
    let { ismine } = await lq.getAddressInfo(address);
    if (ismine) {
      emit(user.username, "to", invoice.user);
      return;
    }
  }

  if (config.liquid.walletpass)
    await lq.walletPassphrase(config.liquid.walletpass, 300);

  amount = parseInt(amount);

  let params = {
    subtractFeeFromOutputs: amount === user.balance ? [0] : []
  };

  let value = (amount / SATS).toFixed(8);
  if (feeRate) params.feeRate = (feeRate / SATS).toFixed(8);

  let info = await lq.getAddressInfo(address);

  tx = await lq.createRawTransaction(
    [],
    [
      {
        [address]: (amount / SATS).toFixed(8),
        asset
      }
    ],
    0,
    replaceable
  );

  l("funding tx for fee estimate", tx);

  tx = await lq.fundRawTransaction(tx, params);

  let blinded = await lq.blindRawTransaction(tx.hex);
  let signed = await lq.signRawTransactionWithWallet(blinded);

  let decoded = await lq.decodeRawTransaction(signed.hex);
  feeRate = Math.round((tx.fee * SATS * 1000) / decoded.vsize);
  l("estimated", asset, feeRate);

  return { feeRate, tx };
};

export default async (req, res) => {
  try {
    let tx = await liquidTx({ ...req.body, user: req.user });
    res.send(tx);
  } catch (e) {
    err("error estimating liquid fee", e.message, e.stack);
    return res.code(500).send(e.message);
  }
};
