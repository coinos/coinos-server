const axios = require("axios");
const crypto = require("crypto");
const bodyParser = require("body-parser");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");
const { Op } = require("sequelize");
const fs = require("fs");

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

if (config.bitcoin) networks.push("bitcoin");
if (config.liquid) networks.push("liquid");
if (config.lna) networks.push("lightning");

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
require("./lib/passport");
require("./lib/rates");
require("./lib/notifications");
require("./lib/register");
require("./lib/send");

require("./lib/mail");

require("./routes/assets");
require("./routes/invoices");
require("./routes/payments");
require("./routes/info");
require("./routes/swaps");
require("./routes/users");
require("./routes/funding");

if (config.lnurl) {
  require("./routes/lnurl");
}

const sigHeaderName = "X-Hub-Signature-256";
const sigHashAlg = "sha256";
function verifyPostData(req, res, next) {
  try {
    if (!req.rawBody) {
      return next("Request body empty");
    }

    const sig = Buffer.from(req.get(sigHeaderName) || "", "utf8");
    const hmac = crypto.createHmac(sigHashAlg, config.github);
    const digest = Buffer.from(
      sigHashAlg + "=" + hmac.update(req.rawBody).digest("hex"),
      "utf8"
    );

    if (sig.length !== digest.length || !crypto.timingSafeEqual(digest, sig)) {
      return next(
        `Request body digest (${digest}) did not match ${sigHeaderName} (${sig})`
      );
    }
  } catch (e) {
    console.log(e.message);
  }

  return next();
}

app.post("/build", (req, res) => {
  const mailgun = require("mailgun-js")(config.mailgun);
  let data = {
    subject: "Build started",
    text: `Build started at ${new Date()}`,
    from: "adam@coinos.io",
    to: "build@coinos.io"
  };

  mailgun.messages().send(data);
  l.info("Build starting");
  fs.writeFileSync("build.json", req.body.payload);

  const { exec } = require("child_process");
  exec("bash build.sh", (error, stdout, stderr) => {
    if (error) {
      data = {
        subject: "Build error",
        text: `Build failed at ${new Date()}`,
        from: "adam@coinos.io",
        to: "build@coinos.io"
      };

      mailgun.messages().send(data);
      l.warn("Build failed");
    } else {
      data = {
        subject: "Build finished",
        text: `Build finished at ${new Date()}`,
        from: "adam@coinos.io",
        to: "build@coinos.io"
      };

      mailgun.messages().send(data);
      l.info("Build finished");
    }
  });
});

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
