import { warn } from "$lib/logging";

// Decode + resize an image in a throwaway child process (lib/image-worker.ts)
// so a native decoder crash cannot take the app down. Resolves with the webp
// bytes; rejects with a short message on any failure (bad image, crash,
// timeout). Never import sharp in the main process — that is the whole point.
const WORKER = process.env.IMAGE_WORKER || "/home/bun/app/lib/image-worker.ts";
const TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 20_000_000;

export const convert = async (input: Buffer, width: number): Promise<Buffer> => {
  const proc = Bun.spawn([process.execPath, WORKER, String(width)], {
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, TIMEOUT_MS);

  try {
    const [out, errText, code] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (timedOut) throw new Error("image conversion timed out");

    if (code !== 0 || proc.signalCode) {
      // Exit 2 is the worker's own "sharp rejected this file"; anything else
      // (signal, Bun panic banner, exit 1) is the decoder dying — log loudly,
      // this is exactly the event the isolation exists for.
      const reason = errText.trim().split("\n").filter(Boolean).slice(-1)[0] || "";
      if (code !== 2)
        warn(`IMAGE_WORKER_CRASH code=${code} signal=${proc.signalCode} ${reason.slice(0, 200)}`);
      throw new Error(code === 2 && reason ? reason.slice(0, 200) : "image conversion failed");
    }

    if (!out.byteLength || out.byteLength > MAX_OUTPUT)
      throw new Error("image conversion produced no output");

    return Buffer.from(out);
  } finally {
    clearTimeout(timer);
  }
};
