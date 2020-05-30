const axios = require("axios");
const bitcoin = require("bitcoinjs-lib");
const coinselect = require("coinselect");
const split = require("coinselect/split");
const api = prod ? "https://blockstream.info/api" : "http://localhost:3002";
const SATS = 100000000;
const network = prod
  ? bitcoin.networks["bitcoin"]
  : bitcoin.networks["regtest"];

module.exports = async (req, res) => {
  let ecpair = bitcoin.ECPair.fromWIF('cVosbTBiXp7LYSiGVRZfZnrEjpao4X4CUTG7Ze21XM3zFTLPCMvk', network);

  let { address: from, amount, feeRate, target } = req.body;
  let utxos;
  if (!feeRate)
    feeRate = ((await bc.estimateSmartFee(6)).feerate * SATS);
  feeRate = Math.round(feeRate / 1000);
  l.info("sweeping", req.user.username, from, amount, feeRate);
  try {
    ({ data: utxos } = await axios.get(`${api}/address/${from}/utxo`));
  } catch (e) {
    l.error("problem fetching utxos", e.message);
  }

  let targets = [
    {
      address: target,
      value: amount
    }
  ];

  let { inputs, outputs, fee } = coinselect(utxos, targets, feeRate);

  if (!inputs || !outputs) return res.status(500).send("Unable to construct sweep transaction, try a lower fee rate?");

  let psbt = new bitcoin.Psbt({ network });

  outputs.map(({ address, value }) => {
    psbt = psbt.addOutput({
      address: address || from,
      value
    })
  });

  for (let i = 0; i < inputs.length; i++) {
    let { txid, vout } = inputs[i];
    let nonWitnessUtxo = Buffer.from(await bc.getRawTransaction(txid), 'hex');
    psbt = psbt.addInput({
      hash: txid,
      index: vout,
      nonWitnessUtxo,
    });
  }

  feeRate = Math.round(feeRate * 1000);
  psbt = psbt.toBase64();
  res.send({ feeRate, psbt });
};
