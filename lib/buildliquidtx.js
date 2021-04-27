const axios = require("axios");
const liquid = require("liquidjs-lib");
const coinselect = require("coinselect");
const split = require("coinselect/split");
const api = prod
  ? "https://blockstream.info/liquid/api"
  : "http://localhost:3002";
const SATS = 100000000;
const network = prod ? liquid.networks["liquid"] : liquid.networks["regtest"];

module.exports = async ({
  address,
  asset,
  amount,
  feeRate,
  replaceable,
  user
}) => {
  const { btcasset: btc } = config.liquid;

  if (!feeRate) {
    let { feerate } = await lq.estimateSmartFee(6);
    if (!feerate) feerate = 0.00002;
    feeRate = feerate * SATS;
  }
  feeRate = Math.round(feeRate / 100);
  if (asset !== btc) feeRate = 0;

  const payments = await db.Payment.findAll({
    where: {
      received: true,
      account_id: user.account_id,
      network: "liquid"
    }
  });

  let utxos = [];
  for (let i = 0; i < payments.length; i++) {
    let url = `${api}/address/${payments[i].address}/utxo`;
    try {
      utxos.push(...(await axios.get(url)).data);
    } catch (e) {
      l.error("problem fetching utxos", e.message, url);
    }
  }

  let feeInput = utxos.find(utxo => utxo.asset === btc && utxo.value > 1000);
  if (!feeInput)
    throw new Error(
      "Insufficient balance, couldn't find an input to cover the fee"
    );

  utxos = utxos.filter(utxo => utxo.asset === asset);

  let feeChange = feeInput.value - 1000;

  let targets = [
    {
      address,
      value: amount
    }
  ];

  let { inputs, outputs, fee } = coinselect(utxos, targets, feeRate);
  if (!inputs || !outputs) {
    l.info(
      "utxos",
      amount,
      feeRate,
      utxos.map(u => u.value),
      inputs,
      outputs,
      fee
    );

    throw new Error(
      "Couldn't find inputs for transaction, check your balance/fee"
    );
  }

  let psbt = new liquid.Psbt({ network });
  let total = 0;

  let { address: changeAddress } = payments[payments.length - 1];

  outputs.map(({ address, value }) => {
    total += value;
    if (!address) {
      address = changeAddress;
      change.push(address);
    }

    psbt = psbt.addOutput({
      address,
      asset,
      value
    });
  });

  for (let i = 0; i < inputs.length; i++) {
    let { txid, vout } = inputs[i];
    psbt = psbt.addInput({
      hash: txid,
      index: vout,
      nonWitnessUtxo: Buffer.from((await lq.getTransaction(txid)).hex, "hex")
    });
  }

  if (asset !== btc) {
    psbt.addInput({
      hash: feeInput.txid,
      index: feeInput.vout,
      nonWitnessUtxo: Buffer.from(
        await lq.getTransaction(feeInput.txid).hex,
        "hex"
      )
    });

    psbt.addOutput({
      changeAddress,
      asset: btc,
      value: feeChange
    });
  }

  psbt.addOutput({
    asset: btc,
    script: Buffer.alloc(0),
    value: fee,
    nonce: Buffer.alloc(1, 0)
  });

  if (replaceable) psbt.setInputSequence(0, 0xffffffff - 2);

  feeRate = Math.round(feeRate * 1000);
  psbt = psbt.toBase64();

  return { tx: psbt, feeRate };
};
