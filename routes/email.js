import { bail } from "$lib/utils";
import got from "got";
import config from "$config";
import { l, warn } from "$lib/logging";
import { SESClient, CloneReceiptRuleSetCommand } from "@aws-sdk/client-ses";
import { SendEmailCommand } from "@aws-sdk/client-ses";

export default {
  async send({ body }, res) {
    try {
      let { email, message, username, token: response } = body;

      let Charset = "UTF-8";

      let { recaptcha: secret } = config;
      let { success } = await got
        .post("https://www.google.com/recaptcha/api/siteverify", {
          form: {
            secret,
            response
          }
        })
        .json();

      if (success || response === config.adminpass) {
        delete body.token;

        warn("support request from", email);
        let client = new SESClient({ region: "us-east-2" });
        await client.send(
          new SendEmailCommand({
            Destination: {
              CcAddresses: [],
              ToAddresses: [config.support]
            },
            Message: {
              Body: {
                Html: { Charset, Data: message.replace(/\n/g, "<br>") },
                Text: { Charset, Data: message }
              },
                Subject: { Charset, Data: body.subject || 'Support Request' + (username ? 'From ' +  username : '') }
            },
            ReplyToAddresses: [email],
            Source: config.support
          })
        );

        res.send({ ok: true });
      } else {
        bail(res, "failed captcha");
      }
    } catch (e) {
      console.log(e);
    }
  }
};
