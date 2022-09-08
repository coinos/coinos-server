import { err } from "$lib/logging";
import send from "$lib/send";

export default async (req, res) => {
  let { amount, route, memo, payreq } = req.body;
  let { user } = req;

  try {
    res.send(await send(amount, memo, payreq, user));
  } catch (e) {
    console.log(e)
    err(
      "problem sending lightning payment",
      user.username,
      payreq,
      e.message
    );
    res.code(500).send(e.message);
  }
};
