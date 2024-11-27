import config from "$config";

const { LightningClient } = (await import("@asoltys/clightning-client")).default;
export default new LightningClient(config.lightning);
export const lnb = new LightningClient(config.lightningb);
