const bodyParser = require("body-parser");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");

l = require("pino")();
config = require("./config");

SATS = 100000000;
toSats = n => parseInt((n * SATS).toFixed())

app = express();
app.enable("trust proxy");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(cors({ credentials: true, origin: "http://*:*" }));
app.use(compression());

server = require("http").Server(app);
require("./db");
require("./lib/sockets");
require("./lib/passport");
require("./lib/rates");

require("./routes/payments");
require("./routes/users");

app.use((err, req, res, next) => {
  l.info("res", res);
  res.status(500);
  res.send("An error occurred");
  l.error("uncaught error", err.stack);
  return res.end();
});

server.listen(config.port, () =>
  console.log(`CoinOS Server listening on port ${config.port}`)
);
