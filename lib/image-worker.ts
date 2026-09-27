// Image conversion runs in THIS separate process, spawned per upload by
// lib/image.ts. It is the only place sharp/libvips is ever loaded. Reads the
// raw upload on stdin, writes the resized webp to stdout, exits 0. Any
// decoder bug (libheif/libwebp/libpng heap corruption, SIGSEGV, SIGILL) kills
// this process alone — the app keeps serving. 2026-09-26: a stream of corrupt
// HEIF uploads crash-looped the whole server when this ran in-process.
const sharp = require("sharp");

const MAX_PIXELS = 80_000_000;

const width = Number(process.argv[2]);
if (!Number.isInteger(width) || width <= 0 || width > 4096) {
  console.error("bad width");
  process.exit(2);
}

try {
  const input = Buffer.from(await new Response(Bun.stdin.stream()).arrayBuffer());
  const out = await sharp(input, { failOnError: true, limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize(width)
    .webp()
    .toBuffer();
  await Bun.write(Bun.stdout, out);
  process.exit(0);
} catch (e) {
  console.error(e?.message || String(e));
  process.exit(2);
}
