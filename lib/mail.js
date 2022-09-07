import app from "$app";
import config from "$config";
import persist from "./persist";
const emails = persist("data/emails.json");

app.post("/email", async (req, res) => {
  try {
    let file = persist("data/emails.json");
    file.emails = [...file.emails, req.body];

    try {
      var postmark = await import("postmark");

      var client = new postmark.ServerClient(config.postmark);

      await client.sendEmail({
        From: "support@coinos.io",
        To: "support@coinos.io",
        Subject: req.body.subject || "Email Signup",
        HtmlBody: JSON.stringify(req.body),
        TextBody: JSON.stringify(req.body),
        MessageStream: "outbound"
      });

      res.send({ ok: true });
    } catch (e) {
      console.log("problem sending email", e);
      res.code(500).send(e.message);
    }
  } catch (e) {
    console.log(e);
    res.code(500).send(e.message);
  }
});
