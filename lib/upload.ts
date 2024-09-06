import { fileTypeFromBuffer } from "file-type";
import { writeFileSync } from "fs";
import { bail, fail } from "$lib/utils";
import { createHash } from "crypto";
import { err } from "$lib/logging";

const sharp = require("sharp");

export default async (req, res) => {
  try {
    let {
      params: { type },
    } = req;

    let data = await req.file();
    let buf = await data.toBuffer();

    let [format, ext] = (await fileTypeFromBuffer(buf)).mime.split("/");

    if (format !== "image" && !["jpg", "jpeg", "png"].includes(ext))
      fail("unsupported file type");

    let w = type === "banner" ? 1920 : 240;
    buf = await sharp(buf, { failOnError: false }).rotate().resize(w).webp().toBuffer();

    let hash = createHash("sha256").update(buf).digest("hex");

    let filePath = `/home/bun/app/data/uploads/${hash}.webp`;
    writeFileSync(filePath, buf);

    res.send({ hash });
  } catch (e) {
    console.log(e);
    err("problem uploading", e.message);
    bail(res, e.message);
  }
};
