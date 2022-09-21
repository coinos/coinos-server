import config from "$config";
let ln;

if (config.lna.clightning) {
  let { LightningClient } = (await import("clightning-client")).default;
  ln = new LightningClient(config.lna.dir);
} else {
  ln = await import("./lnd");
}

export default ln;
