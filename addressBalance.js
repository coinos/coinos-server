const config = require("./config");

module.exports = async (req, res) => {
  let network = config.bitcoin.network === "mainnet" ? "main" : "test3";
  let { address } = req.params;

  try {
    res.send(
      (await axios.get(
        `https://api.blockcypher.com/v1/btc/${network}/addrs/${address}/balance`
      )).data
    );
  } catch (e) {
    res.status(500).send("Problem getting address balance");
  }
};
