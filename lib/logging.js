import pino from "pino";

export let l = (...msgs) => pino().info(msgs.join(" "));
export let warn = (...msgs) => pino().warn(msgs.join(" "));
export let err = (...msgs) => pino().error(msgs.join(" "));

export let line = () => {
  let stack = new Error().stack;
  let stackLine = stack.split("\n")[1];
  let match = stackLine.match(/at\s+(.*):(\d+):(\d+)/);
  return `${match[1]}:${match[2]}`;
};
