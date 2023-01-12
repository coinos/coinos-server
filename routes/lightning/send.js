import { err } from "lib/logging";
import send from "lib/send";
import { requirePin } from "lib/utils";

export default async (req, res) => {
  let { amount, route, memo, payreq } = req.body;
  let { user } = req;

  try {
    await requirePin(req);
    res.send(await send(amount, memo, payreq, user));
  } catch (e) {
    console.log(e);
    err("problem sending lightning payment", user.username, payreq, e.message);
    res.code(500).send(e.message);
  }
};
