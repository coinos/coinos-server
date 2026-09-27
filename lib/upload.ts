import { createHash } from "crypto";
import { writeFileSync } from "fs";
import { db } from "$lib/db";
import { err, warn } from "$lib/logging";
import { bail, fail } from "$lib/utils";
import { convert } from "$lib/image";
import { fileTypeFromBuffer } from "file-type";

// Only the formats whose decoders we are willing to expose to arbitrary
// authenticated input. Decoding happens in a throwaway child process
// (lib/image.ts) since 2026-09-26, when a stream of corrupt HEIF files
// crash-looped the server via heap corruption inside libheif —
// but a crashing decoder is still a decoder we'd rather not run at all.
// HEIF/AVIF/TIFF/SVG/PDF never get past the sniff. The previous check let
// any image/* subtype through.
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Per-account budget. Avatars/banners change a handful of times, ever; the
// fuzzer was pushing 10+ a minute.
const RATE_MAX = 10;
const RATE_WINDOW_S = 600;

const clientIp = (req) => req.headers["cf-connecting-ip"] || req.ip;

export default async (req, res) => {
  const { user } = req;
  try {
    const {
      params: { type },
    } = req;

    // A `blacklist` freeze only blocks sends; the JWT still works everywhere
    // else, which is how a frozen account kept crashing us. Uploads are pure
    // attack surface for a frozen account, so refuse them outright.
    const uname = user?.username?.toLowerCase().trim();
    const blacklisted =
      (await db.sIsMember("blacklist", user.id)) ||
      (await db.sIsMember("blacklist", uname));
    const whitelisted = await db.sIsMember("whitelist", uname);
    if (blacklisted && !whitelisted) {
      warn(`UPLOAD_REJECTED frozen ${user.username} ${clientIp(req)}`);
      fail("unauthorized");
    }

    const rk = `upload:rl:${user.id}`;
    const n = await db.incr(rk);
    if (n === 1) await db.expire(rk, RATE_WINDOW_S);
    if (n > RATE_MAX) {
      warn(`UPLOAD_REJECTED ratelimit ${user.username} ${clientIp(req)} ${n}`);
      fail("too many uploads, try again later");
    }

    const data = await req.file();
    let buf = await data.toBuffer();

    const ft = await fileTypeFromBuffer(buf);
    if (!ft || !ALLOWED.has(ft.mime)) {
      warn(
        `UPLOAD_REJECTED type ${user.username} ${clientIp(req)} ${ft?.mime || "unknown"} ${buf.length}`,
      );
      fail("unsupported file type");
    }

    const w = type === "banner" ? 1920 : 240;
    buf = await convert(buf, w);

    const hash = createHash("sha256").update(buf).digest("hex");

    const filePath = `/home/bun/app/data/uploads/${hash}.webp`;
    writeFileSync(filePath, buf);

    res.send({ hash });
  } catch (e) {
    err("problem uploading", user?.username, e.message);
    bail(res, e.message);
  }
};
