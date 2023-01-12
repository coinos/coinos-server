import config from "config";
import rpc from "./rpc";
export default rpc(config.bitcoin);
