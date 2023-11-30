import { l, err, warn } from "$lib/logging";
import config from "$config";
import { SESClient } from "@aws-sdk/client-ses";
import { SendEmailCommand } from "@aws-sdk/client-ses";
import handlebars from "handlebars";
import fs from "fs";
import path from "path";

let Charset = "UTF-8";

export let templates = {
  paymentSent: "templates/payments/sent.html"
};

export let mail = async (user, subject, template, params) => {
  try {
    l("sending mail", user.username, subject);
    if (!user.email) return;

    let source = fs.readFileSync(templates[template], "utf8");
    let html = handlebars.compile(source)(params);

    let client = new SESClient({ region: "us-east-2" });
    return;

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
    err(e.message);
  }
};

/*
mail({ username: "bob", email: "asoltys@gmail.com" }, "Test", "paymentSent", {
  username: "bob",
  link: "https://coinos.io/api/verify/12345"
});
*/
