import * as net from "net";
import type { Event } from "nostr-tools";

const controlSocketPath = "/home/bun/app/data/sockets/strsrv.sock";

export const scan = (f: object): Promise<Event[]> =>
  new Promise((resolve, reject) => {
    const result = [];
    const client = net
      .createConnection(controlSocketPath)
      .on("connect", () => {
        client.write(`${JSON.stringify(f)}\n`);
      })
      .on("data", (data) => {
        result.push(data);
      })
      .on("end", () => {
        resolve(
          Buffer.concat(result)
            .toString("utf8")
            .split("\n")
            .filter((l) => l)
            .map((l) => JSON.parse(l) as Event),
        );
      })
      .on("error", (e) => {
        reject(e.message);
      });
  });
