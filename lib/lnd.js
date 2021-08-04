const { promisify } = require("util");
const { authenticatedLndGrpc } = require("lightning");

const { cert, macaroon, socket } = config.lna;

const { lnd } = authenticatedLndGrpc({
  cert,
  macaroon,
  socket
});

module.exports = lnd
