import pino from "pino";

export const l = (...msgs) => pino().info(msgs.join(" "));
export const warn = (...msgs) => pino().warn(msgs.join(" "));
export const err = (...msgs) => pino().error(msgs.join(" "));
