const method = "POST";
const str = (p, params) => JSON.stringify({ method: p.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(), params });
const f = (a) => (a.length === 1 && typeof a[0] === "object" && !Array.isArray(a[0]) ? a[0] : a);
const h = (r) => { if (!r) return; if (r.error) throw r.error; return r.result; };

export default ({ host, rune }) => {
  const u = `http://${host}/v1/${method}`;
  const headers = { rune };
  const p = (body) => fetch(u, { method, headers, body }).then((r) => r.json());
  const get = (_, prop) => (...args) =>  p(str(prop, f(args))).then(h);
  return new Proxy({}, { get });
};
