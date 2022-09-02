const multer = require("multer");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads");
  },
  filename: async (req, file, cb) => {
    const parts = file.originalname.split(".");
    const ext = parts.length > 1 ? parts[parts.length - 1] : "bin";
    cb(null, `${req.user.username}-${file.fieldname}.${ext}`);
  }
});

upload = multer({
  storage,
  onFileUploadStart: (file, req, res) => {
    console.log("CHECKING SIZE")
    const maxSize = 32 * 1000 * 1000;
    if (req.files.file.length > maxSize) {
      return false;
    }
  }
});

app.post(
  "/profile",
  auth,
  upload.single("squirt"),
  ah(async (req, res) => {
    let { filename } = req.file;
    res.send({ filename });
  })
);
