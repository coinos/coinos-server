const bolt11 = require("bolt11");
const config = require("./config");
const l = require("pino")();

module.exports = lna => async (req, res) => {
  let hash = req.body.payreq;
  let payreq = bolt11.decode(hash);
  lna.queryRoutes(
    { pub_key: payreq.payeeNodeKey, amt: payreq.satoshis },
    (err, response) => res.send(response)

  );
};
