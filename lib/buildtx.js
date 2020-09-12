const axios = require("axios");
const bitcoin = require("bitcoinjs-lib");
const coinselect = require("coinselect");
const split = require("coinselect/split");
const api = prod ? "https://blockstream.info/api" : "http://localhost:3001";
const SATS = 100000000;
const network = prod
  ? bitcoin.networks["bitcoin"]
  : bitcoin.networks["regtest"];

module.exports = async ({ address, amount, feeRate, replaceable, user }) => {
  if (!feeRate) feeRate = (await bc.estimateSmartFee(6)).feerate * SATS;
  feeRate = Math.round(feeRate / 1000);

  const payments = await db.Payment.findAll({
    where: {
      received: true,
      account_id: user.account_id,
      network: 'bitcoin',
    } 
  });

  const utxos = [];
  for (let i = 0; i < payments.length; i++) {
    try {
      utxos.push(...(await axios.get(`${api}/address/${payments[i].address}/utxo`)).data);
    } catch (e) {
      l.error("problem fetching utxos", e.message);
    }
  } 

  let targets = [
    {
      address,
      value: amount
    }
  ];

  let { inputs, outputs, fee } = coinselect(utxos, targets, feeRate);

  if (!inputs || !outputs) {
    l.info("utxos", amount, feeRate, utxos.map(u => u.value));
    throw new Error("Couldn't find inputs for transaction, check your balance/fee");
  } 

  let psbt = new bitcoin.Psbt({ network });
  let total = 0;

  outputs.map(({ address, value }) => {
    total += value;
    if (!address) {
      address =  payments[payments.length - 1].address;
      change.push(address);
    } 

    psbt = psbt.addOutput({
      address,
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

  if (replaceable) psbt.setInputSequence(0, 0xffffffff - 2);

  feeRate = Math.round(feeRate * 1000);
  psbt = psbt.toBase64();

  return { tx: psbt, feeRate };
};
