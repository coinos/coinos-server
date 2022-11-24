import config from "$config";
let ln;

let { LightningClient } = (await import("clightning-client")).default;
ln = new LightningClient(config.lna.dir);

export default ln;
