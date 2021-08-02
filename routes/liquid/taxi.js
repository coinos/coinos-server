const { ECPair, Psbt, payments, networks } = require("@asoltys/liquidjs-lib");
const wretch = require("wretch");
const fetch = require("node-fetch");
wretch().polyfills({ fetch });
const url = prod
  ? "https://blockstream.info/liquid/api"
  : "http://localhost:3002";
const electrs = wretch().url(url);
const network = networks.regtest;

module.exports = ah(async (req, res) => {
  let { user } = req;
  let { psbt } = req.body;

  let utxos = await electrs
    .url(`/address/XLDLqkbbNKvgS9vhj3fQWPv1Y3UNoHEneZ/utxo`)
    .get()
    .json();
  let tx = utxos.find(tx => tx.value >= 150);
  let hex = await electrs
    .url(`/tx/${tx.txid}/hex/`)
    .get()
    .text();

  let redeemScript = payments.p2wpkh({
    pubkey: Buffer.from(
      "03c42e2b536630da346d8f225797406eb86700239d627101a61e26e6d544db072e",
      "hex"
    ),
    network
  }).output;

  let p = Psbt.fromBase64(psbt)
    .addInput({
      hash: tx.txid,
      index: tx.vout,
      redeemScript,
      nonWitnessUtxo: Buffer.from(hex, "hex")
    })
    .addOutput({
      asset: network.assetHash,
      nonce: Buffer.alloc(1, 0),
      script: Buffer.alloc(0),
      value: 150
    })
    .addOutput({
      asset,
      nonce: Buffer.alloc(1),
      script: Address.toOutputScript(
        "XLDLqkbbNKvgS9vhj3fQWPv1Y3UNoHEneZ",
        network
      ),
      value: tx.value - 150
    })
    .signInput(
      1,
      ECPair.fromPrivateKey(
        Buffer.from(
          "6802b8dfed3733e3b147582810c431150444c026066796b808c36f7089d02773",
          "hex"
        )
      )
    );

  try {
    if ((user.username = "silhouettes")) {
      res.send({ psbt: p.toBase64() });
    } else {
      throw new Error("taxi service only available to select customers");
    }
  } catch (e) {
    return res.status(500).send(e);
  }
});
