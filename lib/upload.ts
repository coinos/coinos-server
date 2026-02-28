import { createHash } from "crypto";
import { writeFileSync } from "fs";
import { err } from "$lib/logging";
import { bail, fail } from "$lib/utils";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

export default async (c) => {
  try {
    const type = c.req.param("type");

    const body = await c.req.parseBody();
    const file = body.file || Object.values(body).find((v) => v instanceof File);
    if (!file) fail("no file uploaded");

    let buf = Buffer.from(await (file as File).arrayBuffer());

    const [format, ext] = (await fileTypeFromBuffer(buf)).mime.split("/");

    if (format !== "image" && !["jpg", "jpeg", "png"].includes(ext)) fail("unsupported file type");

    const w = type === "banner" ? 1920 : 240;
    buf = await sharp(buf, { failOnError: false }).rotate().resize(w).webp().toBuffer();

    const hash = createHash("sha256").update(buf).digest("hex");

    const filePath = `/home/bun/app/data/uploads/${hash}.webp`;
    writeFileSync(filePath, buf);

    return c.json({ hash });
  } catch (e) {
    err("problem uploading", e.message);
    return bail(c, e.message);
  }
};
