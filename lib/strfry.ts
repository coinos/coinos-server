import { createServer, connect } from "net";
import { randomUUID } from "crypto";

let exec = async (cmd) =>
  new Promise((resolve, reject) => {
    let c = `/app/strfry ${cmd} 2>/dev/null`;
    let id = randomUUID();
    const resultSocketPath = `/sockets/result_${id}`;

    const resultServer = createServer((socket) => {
      let resultBuffer = "";

      let results = [];
      socket.on("data", (data) => {
        resultBuffer += data.toString();

        let parts = resultBuffer.split("\n");

        for (let i = 0; i < parts.length - 1; i++) {
          try {
            let parsedObject = JSON.parse(parts[i]);
            results.push(parsedObject);
          } catch (e) {
            console.error(parts[i]);
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
        const message = `${resultSocketPath} ${c}\n`;
        controlClient.write(message);
        controlClient.end();
      });

      controlClient.on("error", (e) =>
        reject(`Control socket error: ${e.message}`),
      );
    });

    resultServer.on("error", (e) =>
      reject(`Result server error: ${e.message}`),
    );
  });

export let scan = (f) => exec(`scan '${JSON.stringify(f)}'\n`)
export let sync = (r, f) => exec(`sync ${r} --dir down --filter '${JSON.stringify(f)}'\n`)
