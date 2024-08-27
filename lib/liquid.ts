import config from "$config";
import rpc from "$lib/rpc";
console.log("LIQ", config.liquid);
export default rpc(config.liquid);
