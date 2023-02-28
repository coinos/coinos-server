import config from "$config";
import sendgrid from "@sendgrid/mail";

export default {
  async send({ body }, res) {
    sendgrid.setApiKey(config.sendgrid);
    const msg = {
      to: "support@coinos.io",
      from: "support@coinos.io",
      subject: body.subject || "Email Signup",
      text: JSON.stringify(body),
      html: JSON.stringify(body)
    };

      await sendgrid.send(msg);
      res.send({ ok: true });
  }
};
