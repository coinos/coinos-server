import app from "./app";
import { l, err } from "./lib/logging";

import "./lib/redis";
import "./lib/sockets";
import "./lib/passport";
import "./lib/upload";
import "./lib/rates";
import "./lib/notifications";
import "./lib/mail";
import "./lib/nostr";

import "./routes/locations";
import "./routes/invoices";
import "./routes/payments";
import "./routes/users";
import "./routes/requests";

let host = process.env.HOST || "0.0.0.0";
let port = process.env.PORT || 3119;
app.listen({ host, port }, (e, address) => {
  e && err(e) && process.exit(1);
  l(`CoinOS Server listening on ${address}`);
});
