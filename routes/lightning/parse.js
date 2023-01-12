import ln from "lib/ln";
import store from "lib/store";

export default async (req, res) => {
  let { payreq } = req.body;
  let hour = 1000 * 60 * 60;
  let { last } = store.nodes;
  let { nodes } = store;

  if (!last || last > Date.now() - hour) ({ nodes } = await ln.listnodes());
  store.nodes = nodes;

  let twoWeeksAgo = new Date(new Date().setDate(new Date().getDate() - 14));
  let { msatoshi, payee } = await ln.decodepay(payreq);
  let node = nodes.find((n) => n.nodeid === payee);
  let alias = node ? node.alias : payee.substr(0, 12);

  res.send({ alias, amount: Math.round(msatoshi / 1000) });
};
