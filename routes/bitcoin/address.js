const axios = require("axios");
const api = "https://blockstream.info/api";

module.exports = async (req, res) => {
  try {
    let { address } = req.body;
    let {
      data: {
        chain_stats: { funded_txo_sum: balance },
      },
    } = await axios.get(`${api}/address/${address}`);

    let utxos = [];
    // let { data: utxos } = await axios.get(`${api}/address/${address}/utxo`);
    res.send({ balance, utxos });
  } catch (e) {
    l.error("error retrieving address info", e.message);
    return res.status(500).send(e.message);
  }
};
