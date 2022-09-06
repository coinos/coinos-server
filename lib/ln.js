import config from "$config";
let ln;

if (config.lna.clightning) {
  ln = (await import("clightning-client"))(config.lna.dir);
} else {
  ln = await import("./lnd");
}

export default ln;
