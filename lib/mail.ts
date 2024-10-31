import { l, err, warn } from "$lib/logging";
import config from "$config";
import { SESClient } from "@aws-sdk/client-ses";
import { SendEmailCommand } from "@aws-sdk/client-ses";
import handlebars from "handlebars";
import fs from "fs";
import path from "path";

const Charset = "UTF-8";

export const templates = {
  verifyEmail: "templates/payments/verify.html",
  paymentReceived: "templates/payments/received.html",
  passwordReset: "templates/payments/reset.html",
};

export const mail = async (user, subject, template, params) => {
  try {
    l("sending mail", user.username, subject);
    if (!user.email) return;

    const source = fs.readFileSync(template, "utf8");
    const html = handlebars.compile(source)(params);

    const client = new SESClient({ region: "us-east-2" });

    await client.send(
      new SendEmailCommand({
        Destination: {
          ToAddresses: [user.email],
        },
        Message: {
          Body: {
            Html: { Charset, Data: html },
          },
          Subject: { Charset, Data: subject },
        },
        Source: `"Coinos " <${config.support}>`,
      }),
    );
  } catch (e) {
    err("failed to send email", e.message);
  }
};
