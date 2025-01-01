import { createHash } from "crypto";
import { writeFileSync } from "fs";
import { err } from "$lib/logging";
import { bail, fail } from "$lib/utils";
import { fileTypeFromBuffer } from "file-type";

const sharp = require("sharp");

export default async (req, res) => {
  try {
    const {
      params: { type },
    } = req;

    const data = await req.file();
    let buf = await data.toBuffer();

    const [format, ext] = (await fileTypeFromBuffer(buf)).mime.split("/");

    if (format !== "image" && !["jpg", "jpeg", "png"].includes(ext))
      fail("unsupported file type");

    const w = type === "banner" ? 1920 : 240;
    buf = await sharp(buf, { failOnError: false })
      .rotate()
      .resize(w)
      .webp()
      .toBuffer();

    const hash = createHash("sha256").update(buf).digest("hex");

    const filePath = `/home/bun/app/data/uploads/${hash}.webp`;
    writeFileSync(filePath, buf);

    res.send({ hash });
  } catch (e) {
    err("problem uploading", e.message);
    bail(res, e.message);
  }
};
