import { l, err, warn } from "$lib/logging";
import config from "$config";
import { SESClient } from "@aws-sdk/client-ses";
import { SendEmailCommand } from "@aws-sdk/client-ses";
import handlebars from "handlebars";
import fs from "fs";
import path from "path";

let Charset = "UTF-8";

export let templates = {
  verifyEmail: "templates/payments/verify.html",
  paymentReceived: "templates/payments/received.html",
  passwordReset: "templates/payments/reset.html"
};

export let mail = async (user, subject, template, params) => {
  try {
    l("sending mail", user.username, subject);
    if (!user.email) return;

    let source = fs.readFileSync(template, "utf8");
    let html = handlebars.compile(source)(params);

    let client = new SESClient({ region: "us-east-2" });

    await client.send(
      new SendEmailCommand({
        Destination: {
          ToAddresses: [user.email]
        },
        Message: {
          Body: {
            Html: { Charset, Data: html }
          },
          Subject: { Charset, Data: subject }
        },
        Source: config.support
      })
    );
  } catch (e) {
    err("failed to send email", e.message);
  }
};
