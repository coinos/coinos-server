import mailgunFactory from 'mailgun-js';
const mailgun = mailgunFactory(config.mailgun);

app.post(
  "/id",
  auth,
  upload.single("id"),
  ah(async (req, res) => {
    const { user } = req;
    if (user.verified === "proof") user.verified = "pending";
    else user.verified = "id";
    await user.save();
    emit(user.username, "user", user);

    let data = {
      subject: "KYC Documents",
      text: `ID uploaded for ${user.username}`,
      from: "server@coinos.io",
      to: "kyc@coinos.io"
    };

    mailgun.messages().send(data);
    l.info("id uploaded", user.username);

    res.end();
  })
);

app.post(
  "/proof",
  auth,
  upload.single("proof"),
  ah(async (req, res) => {
    const { user } = req;
    if (user.verified === "id") user.verified = "pending";
    else user.verified = "proof";
    await user.save();
    emit(user.username, "user", user);
    l.info("id proof uploaded", user.username);

    res.end();
  })
);

app.post(
  "/funding",
  auth,
  ah(async (req, res) => {
    try {
      let { id, amount, code } = req.body;

      if (!code) {
        code = "";
        let d = "ABCDEFGHIJKLMNPQRSTUVWXYZ23456789";
        let l = d.length;
        for (let i = 0; i < 8; i++) {
          code += d.charAt(Math.floor(Math.random() * l));
        }
      }

      let params = {
        user_id: req.user.id,
        amount,
        code
      };

      let deposit;
      if (id) {
        if (!parseFloat(amount) || parseFloat(amount) < 0)
          throw new Error("Invalid amount");
        deposit = await db.Deposit.findOne({ where: { id } });
        deposit.update(params);
        await deposit.save();
      } else {
        deposit = await db.Deposit.create(params);
      }

      res.send(deposit);
    } catch (e) {
      l.error("funding error", e.message);
      res.status(500).send("Funding request failed");
    }
  })
);

app.post(
  "/withdrawal",
  auth,
  ah(async (req, res) => {
    try {
      const { account, amount, email, institution, transit, notes } = req.body;
      if (!parseFloat(amount) || parseFloat(amount) < 0)
        throw new Error("Invalid amount");

      await db.Withdrawal.create({
        user_id: req.user.id,
        account,
        amount,
        email,
        institution,
        transit,
        notes
      });

      res.end();
    } catch (e) {
      l.error("withdrawal error", e.message);
      res.status(500).send("Withdrawal request failed");
    }
  })
);
