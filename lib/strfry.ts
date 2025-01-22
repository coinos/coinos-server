import { randomUUID } from "crypto";
import { connect, createServer } from "net";
import type { Event } from "nostr-tools";

const exec = async (cmd: string, data = ""): Promise<Event[]> =>
  new Promise((resolve, reject) => {
    const c = `${cmd} 2>/dev/null`;
    const id = randomUUID();
    const resultSocketPath = `/sockets/result_${id}`;

    const resultServer = createServer((socket) => {
      let resultBuffer = "";

      const results = [];
      socket.on("data", (chunk) => {
        resultBuffer += chunk.toString();
        const parts = resultBuffer.split("\n");

        for (let i = 0; i < parts.length - 1; i++) {
          try {
            const parsedObject = JSON.parse(parts[i]);
            results.push(parsedObject);
          } catch (e) {
            console.error("Failed to parse:", parts[i]);
          }
        }

        resultBuffer = parts[parts.length - 1];
      });

      socket.on("end", () => {
        socket.write("DONE");
        resolve(results);
        socket.end();

        resultServer.close();
      });
    });

    resultServer.listen(resultSocketPath, () => {
      const controlClient = connect("/sockets/ctrl", () => {
        // Send the command and data payload
        const message = `${resultSocketPath} ${c}\n${data}\n`;
        controlClient.write(message);
        controlClient.end();
      });

      controlClient.on("error", (e) => {
        reject(`Control socket error: ${e.message}`);
      });
    });

    resultServer.on("error", (e) => {
      reject(`Result server error: ${e.message}`);
    });
  });

// const filter2params = (f) => {
//   let r = "";
//
//   const { limit, since, until } = f;
//
//   if (limit) r += `-l ${limit} `;
//   if (since) r += `-s ${since} `;
//   if (until) r += `-u ${until} `;
//
//   for (const k of f.kinds || []) r += `-k ${k} `;
//   for (const a of f.authors || []) r += `-a ${a} `;
//   for (const e of f["#e"] || []) r += `-e ${e} `;
//   for (const p of f["#p"] || []) r += `-p ${p} `;
//
//   return r;
// };

export const load = (data) => exec(`echo '${data}' | /app/strfry import --no-verify\n`);
export const count = (f) =>
  exec(`/app/strfry scan --count '${JSON.stringify(f)}'\n`);
export const scan = (f) => exec(`/app/strfry scan '${JSON.stringify(f)}'\n`);
export const sync = (r, f) =>
  exec(`/app/strfry sync ${r} --dir down --filter '${JSON.stringify(f)}'\n`);
