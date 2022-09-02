import app from "./app.js";
import axios from "axios";
import bodyParser from "body-parser";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { Op } from "@sequelize/core";
import persist from "./lib/persist.js";
import config from "./config/index.js";
import { networks } from "./lib/store.js";

// app = express();
// app.enable("trust proxy");
// app.use(bodyParser.urlencoded({ extended: true });
// app.use(bodyParser.json());
//
// app.use((err, req, res, next) => {
//   const details = {
//     path: req.path,
//     body: req.body,
//     msg: err.message,
//     stack: err.stack
//   };
//
//   if (req.user) details.username = req.user.username;
//
//   err("JSON Error: ", JSON.stringify(details));
//   res.status(500);
//   res.set({
//     "Cache-Control": "no-cache"
//   });
//   res.send(err.message);
//   return res.end();
// });
// app.use(cookieParser());
// app.use(cors({ credentials: true, origin: "*" });
// app.use(compression());

import "./lib/logging.js";
import "./lib/utils.js";
import "./lib/sockets.js";
import "./lib/webhooks.js";
import "./lib/passport.js";
import "./lib/register.js";
import "./lib/upload.js";
import "./lib/send.js";
import "./lib/sync.js";
import "./routes/assets.js";
import "./routes/info.js";
import "./routes/users.js";
if (config.bitcoin) networks.push("bitcoin");
if (config.liquid) networks.push("liquid");
if (config.lna) networks.push("lightning");

import "./lib/rates.js";
import "./lib/notifications.js";

if (config.imap) import("./lib/mail.js");
if (config.lnurl) import("./routes/lnurl.js");
if (config.mailgun) import ("./routes/funding.js");

import "./routes/invoices.js";
import "./routes/payments.js";
// import "./routes/swaps.js";

//  Scope based Route Handling

// import referralsRouter from './routes/referrals.js';

// app.use("/referrals", referralsRouter);

// import adminRouter from './routes/admin.js';
// app.use("/admin", adminAuth, adminRouter);

import "./startup.js";

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

app.listen(process.env.PORT || 3119, "0.0.0.0", function(err, address) {
  if (err) {
    console.log(err);
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`CoinOS Server listening on ${address}`);
});

process.on("SIGINT", process.exit);

process.on("uncaughtException", function(exception) {
  console.log(exception);
});
