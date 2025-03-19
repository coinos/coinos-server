import config from "$config";

const method = "POST";
const kb = (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
const str = (o) => JSON.stringify(o);
const j = (r) => r.json();

const RPC = ({ host, rune }) => {
  const u = `http://${host}/v1`;
  const headers = { rune };
  const p = (cmd, body) => {
    console.log(cmd, body);
    return fetch(`${u}/${cmd}`, { method, headers, body });
  }
  const get = (_, cmd) => (args) => p(kb(cmd), str(args)).then(j);
  return new Proxy({}, { get });
};

export default RPC(config.lightning);
export const lnb = RPC(config.lightningb);
