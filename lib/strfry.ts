import { connect } from "net";

export default (cmd) =>
  new Promise((r, j) => {
    let results = [];
    let c = `/app/strfry ${cmd} 2>/dev/null\n`;
    let client = connect("/sockets/ctrl", () => client.write(c));

    let s = "";
    client.on("data", (data) => {
      s += data.toString();
   //   console.log("S", s);

      try {
        let parts = s.split("}");

        for (let i = 0; i < parts.length - 1; i++) {
          let completeJson = parts[i] + "}";
          results.push(JSON.parse(completeJson));
        }

        s = parts[parts.length - 1];
      } catch (err) {
        console.error("Error parsing JSON:", err.message);
      }
    });

    client.on("error", (e) => j(e.message));
    client.on("close", () => r(results));
  });
