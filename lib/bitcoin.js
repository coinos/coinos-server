import config from "$config/index.js";
import rpc from "./rpc.js";
export default rpc(config.bitcoin);
