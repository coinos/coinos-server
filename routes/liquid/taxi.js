const {
  address: Address,
  Psbt,
  payments,
  networks
} = require("liquidjs-lib");

const { ECPairFactory} = require('ecpair');
const tinysecp = require('tiny-secp256k1');

const wretch = require("wretch");
const fetch = require("node-fetch");

wretch().polyfills({ fetch });

const url = prod
  ? "https://blockstream.info/liquid/api"
  : "http://electrs-liquid:3002";

const electrs = wretch().url(url);
const network = prod ? networks.liquid : networks.regtest;

const ECPair = ECPairFactory(tinysecp);
const key = ECPair.fromPrivateKey(Buffer.from(config.taxi, "hex"));

module.exports = ah(async (req, res) => {
  let { user } = req;
  let { psbt } = req.body;

  try {
    if (user.username !== "silhouettes") {
      throw new Error("taxi service only available to select customers");
    }

    let redeem = payments.p2wpkh({
      pubkey: key.publicKey,
      network
    });

    let out = payments.p2sh({
      redeem,
      network
    });

    let utxos = await electrs
      .url(`/address/${out.address}/utxo`)
      .get()
      .json();

    let tx = utxos.find(tx => tx.value >= 150);

    let hex = await electrs
      .url(`/tx/${tx.txid}/hex`)
      .get()
      .text();

    let raw = Psbt.fromBase64(psbt)
      .addInput({
        hash: tx.txid,
        index: tx.vout,
        redeemScript: redeem.output,
        nonWitnessUtxo: Buffer.from(hex, "hex")
      })
      .addOutput({
        asset: network.assetHash,
        nonce: Buffer.alloc(1, 0),
        script: Buffer.alloc(0),
        value: 150
      })
      .addOutput({
        asset: network.assetHash,
        nonce: Buffer.alloc(1),
        script: out.output,
        value: tx.value - 150
      })
      .signInput(1, key)
      .finalizeInput(1)
      .extractTransaction()
      .toHex();

    let txid = await electrs
      .url("/tx")
      .body(raw)
      .post()
      .text();

    res.send({ txid });
  } catch (e) {
    console.log(e);
    return res.status(500).send(e);
  }
});
