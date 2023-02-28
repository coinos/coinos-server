import config from "$config";

export default {
  async send({ body }, res) {
    
    try {
      let postmark = await import("postmark");
      let client = new postmark.ServerClient(config.postmark);

      await client.sendEmail({
        From: "support@coinos.io",
        To: "support@coinos.io",
        Subject: body.subject || "Email Signup",
        HtmlBody: JSON.stringify(body),
        TextBody: JSON.stringify(body),
        MessageStream: "outbound"
      });

      res.send({ ok: true });
    } catch (e) {
      console.log("problem sending email", e);
      res.code(500).send(e.message);
    }
  }
};
