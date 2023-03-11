import { bail } from "$lib/utils";
import got from "got";
import config from "$config";
import sendgrid from "@sendgrid/mail";

export default {
  async send({ body }, res) {
    let { token: response } = body;
    let { recaptcha: secret } = config;
    let { success } = await got
      .post("https://www.google.com/recaptcha/api/siteverify", {
        form: {
          secret,
          response,
        },
      })
      .json();

    if (success) {
      delete body.token;
      sendgrid.setApiKey(config.sendgrid);
      const msg = {
        to: "support@coinos.io",
        from: "support@coinos.io",
        subject: body.subject || "Email Signup",
        text: JSON.stringify(body),
        html: JSON.stringify(body),
      };

      await sendgrid.send(msg);
      res.send({ ok: true });
    } else {
      bail(res, "failed captcha");
    }
  },
};
