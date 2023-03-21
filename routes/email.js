import { bail } from "$lib/utils";
import got from "got";
import config from "$config";
import { SESClient, CloneReceiptRuleSetCommand } from "@aws-sdk/client-ses";
import { SendEmailCommand } from "@aws-sdk/client-ses";

export default {
  async send({ body }, res) {
    let { token: response } = body;
    let { recaptcha: secret } = config;
    let { success } = await got
      .post("https://www.google.com/recaptcha/api/siteverify", {
        form: {
          secret,
          response
        }
      })
      .json();

    if (success) {
      delete body.token;

      let client = new SESClient({ region: "us-east-2" });
      await client.send(
        new SendEmailCommand({
          Destination: {
            CcAddresses: [],
            ToAddresses: ["support@coinos.io"]
          },
          Message: {
            Body: {
              Html: {
                Charset: "UTF-8",
                Data: JSON.stringify(body)
              },
              Text: {
                Charset: "UTF-8",
                Data: JSON.stringify(body)
              }
            },
            Subject: {
              Charset: "UTF-8",
              Data: body.subject || "Email Signup"
            }
          },
          Source: "support@coinos.io"
        })
      );

      res.send({ ok: true });
    } else {
      bail(res, "failed captcha");
    }
  }
};
