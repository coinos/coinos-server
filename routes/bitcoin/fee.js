import config from "$config";
import db from "$db";
import bc from "$lib/bitcoin";
import { err } from "$lib/logging";
import { emit } from "$lib/sockets";
import buildTx from "$lib/buildtx";
import { SATS } from "$lib/utils";

export default async (req, res) => {
  let { user } = req;
  let { address, amount, feeRate, replaceable = true } = req.body;
  let tx, fee;

  if (user.account.pubkey) {
    try {
      let psbt = await buildTx({ address, amount, feeRate, replaceable, user });
      return res.send(psbt);
    } catch (e) {
      return res.code(500).send(e.message);
    }
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
    let { ismine } = await bc.getAddressInfo(address);
    if (ismine) {
      emit(user.username, "to", invoice.user);
      return res.send({});
    }
  }

  try {
    amount = parseInt(amount);

    let partial = await bc.createRawTransaction(
      [],
      {
        [address]: (amount / SATS).toFixed(8)
      },
      0,
      replaceable
    );

    let params = {
      subtractFeeFromOutputs: amount === user.balance ? [0] : [],
      replaceable
    };

    if (feeRate) params.feeRate = (feeRate / SATS).toFixed(8);

    tx = await bc.fundRawTransaction(partial, params);

    if (config.bitcoin.walletpass)
      await bc.walletPassphrase(config.bitcoin.walletpass, 300);

    let signed = await bc.signRawTransactionWithWallet(tx.hex);
    let decoded = await bc.decodeRawTransaction(signed.hex);
    feeRate = Math.round((tx.fee * SATS * 1000) / decoded.vsize);

    res.send({ feeRate, tx });
  } catch (e) {
    err("bitcoin fee estimation error", e);
    return res.code(500).send(e.message);
  }
};
