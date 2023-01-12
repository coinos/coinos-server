import app from "app";
import { auth } from "./passport";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { fileTypeFromStream } from "file-type";
import pump from "pump";
import Clone from "readable-stream-clone";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { pipeline } from "stream";

app.register(fastifyMultipart);

app.register(fastifyStatic, {
  root: path.join("/app/uploads"),
  prefix: "/public/"
});

app.post("/upload/:type", auth, async function(req, res) {
  try {
    let { type } = req.params;
    if (!["banner", "profile"].includes(type))
      throw new Error("invalid upload");

    let data = await req.file();
    let s1 = new Clone(data.file);
    let s2 = new Clone(data.file);

    let [format, ext] = (await fileTypeFromStream(s1)).mime.split("/");

    if (format !== "image" && !["jpg", "jpeg", "png"].includes(ext))
      throw new Error("unsupported file type");

    let name = `${req.user.uuid}-${type}.webp`;
    let path = `/app/uploads/${name}`;
    let size = type === "banner" ? 1920 : 240;

    let t = sharp()
      .rotate()
      .resize(size)
      .webp();

    await new Promise(r => pipeline(s2, t, fs.createWriteStream(path), r));

    req.user[type] = true;
    await req.user.save();

    res.send(name);
  } catch (e) {
    console.log(e);
    return res.code(500).send(e);
  }
});
