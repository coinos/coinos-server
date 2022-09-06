import config from "$config";
import { authenticatedLndGrpc } from "lightning";

const { cert, macaroon, socket } = config.lna;

const { lnd } = authenticatedLndGrpc({
  cert,
  macaroon,
  socket
});

export default lnd;
