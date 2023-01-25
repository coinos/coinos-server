import { fileTypeFromStream } from "file-type";
import pump from "pump";
import Clone from "readable-stream-clone";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { pipeline } from "stream";
import { g, s } from "$lib/db";

export default async ({ params: { type }, file, user }, res) => {
  if (!["banner", "profile"].includes(type)) throw new Error("invalid upload");

  let data = await file();
  let s1 = new Clone(data.file);
  let s2 = new Clone(data.file);

  let [format, ext] = (await fileTypeFromStream(s1)).mime.split("/");

  if (format !== "image" && !["jpg", "jpeg", "png"].includes(ext))
    throw new Error("unsupported file type");

  let name = `${user.id}-${type}.webp`;
  let path = `/app/data/uploads/${name}`;
  let size = type === "banner" ? 1920 : 240;

  let t = sharp()
    .rotate()
    .resize(size)
    .webp();

  await new Promise(r => pipeline(s2, t, fs.createWriteStream(path), r));

  let r = async () => {
    await db.watch(`user:${user.id}`);
    user = await g(`user:${user.id}`);
    user[type] = true;
    let m = await db.multi();
    await s(`user:${user.id}`, user);
  };
  await r();

  res.send(name);
};
