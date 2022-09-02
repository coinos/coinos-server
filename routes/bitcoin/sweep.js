import axios from 'axios';
import bitcoin from 'bitcoinjs-lib';
import coinselect from 'coinselect';
import split from 'coinselect/split';
const api = prod ? "https://blockstream.info/api" : config.bitcoin.electrs;
const SATS = 100000000;
const network = prod
  ? bitcoin.networks["bitcoin"]
  : bitcoin.networks["regtest"];

export default ah(async (req, res) => {
  let { address: from, amount, feeRate, target } = req.body;
  let utxos;
  if (!feeRate) feeRate = (await bc.estimateSmartFee(6)).feerate * SATS;
  feeRate = Math.round(feeRate / 1000);
  l.info("sweeping", req.user.username, from, amount, feeRate);

  try {
    let {
      data: {
        chain_stats: { funded_txo_sum: funded, spent_txo_sum: spent }
      }
    } = await axios.get(`${api}/address/${from}`);
    let balance = funded - spent;
    console.log("boom");

    try {
      console.log("fetching utxo");
      ({ data: utxos } = await axios.get(`${api}/address/${from}/utxo`));
      console.log("got utxos", utxos);
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

    if (balance === amount) {
      delete targets[0].value;
      ({ inputs, outputs, fee } = split(utxos, targets, feeRate));
      l.info("split", inputs, outputs, fee);
    }

    if (!inputs || !outputs)
      return res
        .status(500)
        .send("Unable to construct sweep transaction, try a lower fee rate?");

    let psbt = new bitcoin.Psbt({ network });
    let total = 0;

    outputs.map(({ address, value }) => {
      total += value;
      psbt = psbt.addOutput({
        address: address || from,
        value
      });
    });

    for (let i = 0; i < inputs.length; i++) {
      let { txid, vout } = inputs[i];
      let nonWitnessUtxo = Buffer.from(await bc.getRawTransaction(txid), "hex");
      psbt = psbt.addInput({
        hash: txid,
        index: vout,
        nonWitnessUtxo
      });
    }

    feeRate = Math.round(feeRate * 1000);
    psbt = psbt.toBase64();

    if (balance !== amount) total = 0;
    res.send({ feeRate, psbt, total });
  } catch (e) {
    l.error("problem getting address stats", from, e.message);
  }
});
