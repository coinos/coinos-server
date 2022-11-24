import axios from "axios";
import ln from "$lib/ln";

export default async (req, res) => {
  const { params } = req.body;
  const [public_key, socket] = params.uri.split("@");

  l("connecting to peer", req.user.username, public_key, socket);
  let result;

  const { callback, k1 } = params;
  let remoteid;
  try {
      remoteid = (await ln.getinfo()).id;
  } catch (e) {
    err("problem getting lightning node info", e.message);
    return res.code(500).send(e.message);
  }

  let url = `${callback}?k1=${k1}&remoteid=${remoteid}&private=0`;

  try {
    let response = await axios.get(url);
    res.send(response.data);
  } catch (e) {
    err("problem sending channel request", e.message);
    return res.code(500).send({ status: "ERROR", reason: e.message });
  }
};
