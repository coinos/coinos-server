import app from "./app";
import persist from "./lib/persist";
import config from "./config/index";
import store from "./lib/store";
import { l, err } from "./lib/logging";

import "./db";
import "./lib/sockets";
import "./lib/webhooks";
import "./lib/passport";
import "./lib/upload";
import "./lib/sync";
import "./lib/rates";
import "./lib/notifications";
import "./lib/mail";

import "./routes/assets";
import "./routes/info";
import "./routes/users";
import "./routes/invoices";
import "./routes/payments";
import "./routes/lnurl";

if (config.bitcoin) store.networks.push("bitcoin");
if (config.liquid) store.networks.push("liquid");
if (config.lna) store.networks.push("lightning");

let host = process.env.HOST || "0.0.0.0";
let port = process.env.PORT || 3119;

app.listen({ host, port }, (e, address) => {
  e && err(e) && process.exit(1);
  l(`CoinOS Server listening on ${address}`);
});
