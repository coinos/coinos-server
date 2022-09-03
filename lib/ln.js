import config from "../config/index.js";
let ln;

if (config.lna.clightning) {
  ln = (await import("clightning-client"))(config.lna.dir);
} else {
  ln = (await import("./lnd.js"));
}

export default ln;
