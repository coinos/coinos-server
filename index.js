import axios from 'axios';
import bodyParser from 'body-parser';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { Op } from 'sequelize';
import persist from './lib/persist.js';

ah = require("express-async-handler");

config = require("./config");
networks = [];
prod = process.env.NODE_ENV === "production";
fail = msg => {
  throw new Error(msg);
};

addresses = {};
challenge = {};
change = [];
exceptions = [];
issuances = {};
logins = {};
seen = [];
sessions = {};
sockets = {};
unaccounted = [];

convert = persist("data/conversions.json");

SATS = 100000000;
toSats = n => Math.round(n * SATS);

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

  l.error("JSON Error: ", JSON.stringify(details));
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

import './db/index.js';
import './lib/logging.js';
import './lib/utils.js';
import './lib/sockets.js';
import './lib/webhooks.js';
import './lib/passport.js';
import './lib/register.js';
import './lib/upload.js';
import './lib/send.js';
import './lib/sync.js';
import './routes/assets.js';
import './routes/info.js';
import './routes/users.js';
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

//  Scope based Route Handling

import referralsRouter from './routes/referrals.js';

app.use("/referrals", referralsRouter);

import adminRouter from './routes/admin.js';
app.use("/admin", adminAuth, adminRouter);

import './startup.js';

app.post("/email", async (req, res) => {
  try {
    let file = persist("data/emails.json");
    file.emails = [...file.emails, req.body];

    try {
      // Require:
      var postmark = require("postmark");

      // Send an email:
      var client = new postmark.ServerClient(config.postmark);

      await client.sendEmail({
        From: "support@coinos.io",
        To: "support@coinos.io",
        Subject: req.body.subject || "Email Signup",
        HtmlBody: JSON.stringify(req.body),
        TextBody: JSON.stringify(req.body),
        MessageStream: "outbound"
      });

      res.send({ ok: true });
    } catch (e) {
      console.log("problem sending email", e);
      res.code(500).send(e.message);
    }
  } catch (e) {
    console.log(e);
    res.code(500).send(e.message);
  }
});

app.use((err, req, res, next) => {
  const details = {
    path: req.path,
    body: req.body,
    msg: err.message,
    stack: err.stack
  };

  if (req.user) details.username = req.user.username;

  l.error("uncaught error: ", JSON.stringify(details));
  res.status(500);
  res.set({
    "Cache-Control": "no-cache"
  });
  res.send(err.message);
});

server.listen(config.port, () =>
  l.info(`CoinOS Server listening on port ${config.port}`)
);

process.on("SIGINT", process.exit);

process.on("uncaughtException", function(exception) {
  console.log(exception);
});
