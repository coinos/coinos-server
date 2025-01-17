import { bail } from "$lib/utils";
import got from "got";
import config from "$config";
import { l, warn } from "$lib/logging";
import { SESClient } from "@aws-sdk/client-ses";
import { SendEmailCommand } from "@aws-sdk/client-ses";

export default {
  async send({ body }, res) {
    try {
      const { email, message, username, token: response } = body;

      const Charset = "UTF-8";

      const { recaptcha: secret } = config;
      const { success } = await got
        .post("https://www.google.com/recaptcha/api/siteverify", {
          form: {
            secret,
            response,
          },
        })
        .json();

      if (success || response === config.adminpass) {
        body.token = undefined;

        warn("support request from", email);
        const client = new SESClient({ region: "us-east-2" });
        await client.send(
          new SendEmailCommand({
            Destination: {
              CcAddresses: [],
              ToAddresses: [config.support],
            },
            Message: {
              Body: {
                Html: { Charset, Data: message.replace(/\n/g, "<br>") },
                Text: { Charset, Data: message },
              },
              Subject: {
                Charset,
                Data:
                  body.subject ||
                  `Support Request${username ? ` From ${username}` : ""}`,
              },
            },
            ReplyToAddresses: [email],
            Source: config.support,
          }),
        );

        res.send({ ok: true });
      } else {
        bail(res, "failed captcha");
      }
    } catch (e) {
      console.log(e);
    }
  },
};
