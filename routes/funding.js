const multer = require("multer");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads");
  },
  filename: (req, file, cb) => {
    const parts = file.originalname.split(".");
    const ext = parts.length > 1 ? parts[parts.length - 1] : 'bin';
    cb(null, `${req.user.username}-${file.fieldname}.${ext}`)
  }
});

const upload = multer({
  storage,
  onFileUploadStart: (file, req, res) => {
    const maxSize = 32 * 1000 * 1000;
    if (req.files.file.length > maxSize) {
      return false;
    }
  }
});

app.post("/id", auth, upload.single("id"), ah(async (req, res) => {
  const { user } = req;
  if (user.verified === 'proof') user.verified = 'pending';
  else user.verified = 'id';
  await user.save();
  emit(user.username, "user", user);

  res.end();
}));

app.post("/proof", auth, upload.single("proof"), ah(async (req, res) => {
  const { user } = req;
  if (user.verified === 'id') user.verified = 'pending';
  else user.verified = 'proof';
  await user.save();
  emit(user.username, "user", user);

  res.end();
}));

app.post("/funding", auth, ah(async (req, res) => {
  try {
    let { id, amount, code } = req.body;

    if (!code) {
      code = '';
      let d = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789';
      let l = d.length;
      for (let i = 0; i < 8; i++) {
        code += d.charAt(Math.floor(Math.random() * l));
      }
    }

    let params = {
      user_id: req.user.id,
      amount,
      code,
    };

    let deposit;
    if (id) {
      if (!parseFloat(amount) || parseFloat(amount) < 0) throw new Error("Invalid amount");
      deposit = await db.Deposit.findOne({ where: { id } })
      deposit.update(params);
      await deposit.save();
    } else { 
      deposit = await db.Deposit.create(params);
    }

    res.send(deposit);
  } catch(e) {
    l.error("funding error", e.message);
    res.status(500).send("Funding request failed");
  } 
}));

app.post("/withdrawal", auth, ah(async (req, res) => {
  try {
    const { account, amount, email, institution, transit, notes } = req.body;
    if (!parseFloat(amount) || parseFloat(amount) < 0) throw new Error("Invalid amount");

    await db.Withdrawal.create({
      user_id: req.user.id,
      account,
      amount,
      email,
      institution,
      transit,
      notes,
    });

    res.end();
  } catch(e) {
    l.error("withdrawal error", e.message);
    res.status(500).send("Withdrawal request failed");
  } 
}));
