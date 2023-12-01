import { fileTypeFromStream } from "file-type";
import pump from "pump";
import Clone from "readable-stream-clone";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { pipeline } from "stream";
import { g, s, db } from "$lib/db";
import crypto from "crypto";

async function getSha256Hash(stream) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    stream.pipe(hash);

    let hashValue;
    hash.on("data", (data) => {
      hashValue = data.toString("hex");
    });

    hash.on("end", () => {
      resolve(hashValue);
    });

    hash.on("error", reject);
  });
}

export default async (req, res) => {
  let {
    params: { type }
  } = req;

  let width = type === "banner" ? 1920 : 240;

  let data = await req.file();
  let s1 = new Clone(data.file);
  let s2 = new Clone(data.file);

  let [format, ext] = (await fileTypeFromStream(s1)).mime.split("/");

  if (format !== "image" && !["jpg", "jpeg", "png"].includes(ext))
    throw new Error("unsupported file type");

  let t = sharp().rotate().resize(width).webp();

  let processedBuffer = await streamToBuffer(s2.pipe(t));
  let hash = crypto.createHash("sha256").update(processedBuffer).digest("hex");

  let filePath = `/app/data/uploads/${hash}.webp`;
  fs.writeFileSync(filePath, processedBuffer);

  res.send({ hash });
};

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
