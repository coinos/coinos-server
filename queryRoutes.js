const bolt11 = require("bolt11");
const config = require("./config");

const l = console.log;

module.exports = (app, db, emit, seen, lna, lnb) => async (req, res) => {
  let hash = req.body.payreq;
  let payreq = bolt11.decode(hash);
  l(payreq);
  const routes = await lna.queryRoutes({ "pub_key": payreq.payeeNodeKey, "amt": payreq.satoshis });
  res.send(routes);
};
