import config from "../config/index.js";
import { authenticatedLndGrpc } from 'lightning';

const { cert, macaroon, socket } = config.lna;

const { lnd } = authenticatedLndGrpc({
  cert,
  macaroon,
  socket
});

export default lnd;
