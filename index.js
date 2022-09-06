import app from "./app";
import persist from "./lib/persist";
import config from "./config/index";
import store from "./lib/store";
import { l } from "./lib/logging";

import "./db";
import "./lib/sockets";
import "./lib/webhooks";
import "./lib/passport";
import "./lib/upload";
import "./lib/sync";
import "./routes/assets";
import "./routes/info";
import "./routes/users";

if (config.bitcoin) store.networks.push("bitcoin");
if (config.liquid) store.networks.push("liquid");
if (config.lna) store.networks.push("lightning");

import "./lib/rates";
import "./lib/notifications";

// if (config.imap) import("./lib/mail");
// if (config.lnurl) import("./routes/lnurl");
// if (config.mailgun) import("./routes/funding");
//
import "./routes/invoices";
import "./routes/payments";
// import "./routes/swaps";

//  Scope based Route Handling

// import referralsRouter from './routes/referrals';

// app.use("/referrals", referralsRouter);

// import adminRouter from './routes/admin';
// app.use("/admin", adminAuth, adminRouter);

import "./startup";

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

app.listen({ port: process.env.PORT || 3119, host: "0.0.0.0" }, function(
  err,
  address
) {
  if (err) {
    console.log(err);
    app.log.error(err);
    process.exit(1);
  }
  l(`CoinOS Server listening on ${address}`);
});

process.on("SIGINT", process.exit);

process.on("uncaughtException", function(exception) {
  console.log(exception);
});
