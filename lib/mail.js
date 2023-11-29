import config from "$config";
import { SESClient } from "@aws-sdk/client-ses";
import { SendEmailCommand } from "@aws-sdk/client-ses";
import handlebars from "handlebars";
import fs from "fs";
import path from "path";

export let templates = {
  paymentSent: "templates/payments/sent.html"
};

export let mail = async (user, subject, template, params) => {
  if (!user.email) return;

  let source = fs.readFileSync(path.join(__dirname, template), "utf8");
  let html = handlebars.compile(source, params);

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
};
