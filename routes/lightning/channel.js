import axios from "axios";

export default async (req, res) => {
  const { params } = req.body;
  const [pubkey, host] = params.uri.split("@");

  l.info("connecting to peer", req.user.username, pubkey, host);
  let result;
  try {
    result = await lnp.connectPeer({
      addr: { pubkey, host },
      perm: true
    });
  } catch (e) {
    if (!e.message.includes("already connected")) {
      l.error("problem connecting to peer", e.message);
      return res.status(500).send(e.message);
    }
  }

  const { callback, k1 } = params;
  let remoteid;
  try {
    remoteid = (await lnp.getInfo({})).identity_pubkey;
  } catch (e) {
    l.error("problem getting lightning node info", e.message);
    return res.status(500).send(e.message);
  }

  let url = `${callback}?k1=${k1}&remoteid=${remoteid}&private=0`;

  try {
    let response = await axios.get(url);
    res.send(response.data);
  } catch (e) {
    l.error("problem sending channel request", e.message);
    return res.status(500).send({ status: "ERROR", reason: e.message });
  }
};
