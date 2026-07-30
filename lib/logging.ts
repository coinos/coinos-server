import pino from "pino";

export const l = (...msgs) => pino().info(msgs.join(" "));
export const warn = (...msgs) => pino().warn(msgs.join(" "));
export const err = (...msgs) => pino().error(msgs.join(" "));

// Collapse a verbose error message for logging. CLN's xpay concatenates one
// failure sentence per routing retry (e.g. "We got temporary_channel_failure
// for X … updating our map." repeated 50+ times), which floods the logs on an
// ordinary failed lightning send. Dedupe repeated sentences and cap length.
export const shortError = (msg: any, max = 400): string => {
  let s = typeof msg === "string" ? msg : msg?.message ?? String(msg);
  const parts = s.split(/(?<=\.)\s+/);
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (t && !seen.has(t)) { seen.add(t); uniq.push(t); }
  }
  s = uniq.join(" ");
  const dropped = parts.length - uniq.length;
  if (dropped > 0) s += ` [${dropped} repeated lines collapsed]`;
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

export const line = () => {
  const stack = new Error().stack;
  const stackLine = stack.split("\n")[1];
  const match = stackLine.match(/at\s+(.*):(\d+):(\d+)/);
  return `${match[1]}:${match[2]}`;
};
