const axios = require("axios");
const bodyParser = require("body-parser");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");
const { Op } = require("sequelize");

ah = require("express-async-handler");

l = require("pino")();
config = require("./config");
networks = [];
prod = process.env.NODE_ENV === "production";
fail = msg => {
  throw new Error(msg);
};

challenge = {};
convert = {};
logins = {};
sessions = {};
sockets = {};

SATS = 100000000;
toSats = n => parseInt((n * SATS).toFixed());

app = express();
app.enable("trust proxy");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use((err, req, res, next) => {
  const details = {
    path: req.path,
    body: req.body,
    msg: err.message,
    stack: err.stack
  };

  if (req.user) details.username = req.user.username;

  l.error("JSON Error: ", details);
  res.status(500);
  res.set({
    "Cache-Control": "no-cache"
  });
  res.send(err.message);
  return res.end();
});
app.use(cookieParser());
app.use(cors({ credentials: true, origin: "*" }));
app.use(compression());

server = require("http").Server(app);

require("./db");
require("./lib/utils");
require("./lib/sockets");
require("./lib/webhooks");
require("./lib/passport");
require("./lib/register");
require("./lib/send");

require("./routes/assets");
require("./routes/info");

require("./routes/users");

// Exclude plugins for minimalist version
if (process.env.SCOPE !== "MIN") {
  if (config.bitcoin) networks.push("bitcoin");
  if (config.liquid) networks.push("liquid");
  if (config.lna) networks.push("lightning");

  require("./lib/rates");
  require("./lib/notifications");

  if (config.imap) require("./lib/mail");
  if (config.lnurl) require("./routes/lnurl");
  if (config.mailgun) require("./routes/funding");

  require("./routes/invoices");
  require("./routes/payments");
  require("./routes/swaps");
}

//  Scope based Route Handling

var referralsRouter = require("./routes/referrals.js");
app.use("/referrals", referralsRouter);

var adminRouter = require("./routes/admin.js");
app.use("/admin", adminAuth, adminRouter);

require("./startup");

app.use((err, req, res, next) => {
  const details = {
    path: req.path,
    body: req.body,
    msg: err.message,
    stack: err.stack
  };

  if (req.user) details.username = req.user.username;

  l.error("Error: ", details);
  res.status(500);
  res.set({
    "Cache-Control": "no-cache"
  });
  res.send(err.message);
});

server.listen(config.port, () =>
  console.log(`CoinOS Server listening on port ${config.port}`)
);

process.on("SIGINT", process.exit);

process.on("uncaughtException", function(exception) {
  console.log(exception);
});

