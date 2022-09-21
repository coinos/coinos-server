import { err } from "$lib/logging";
import sendInternal from "$lib/sendInternal";

export default async (req, res, next) => {
  try {
    let payment = await sendInternal(req.body, req.hostname, req.user);
    res.send(payment);
  } catch (e) {
    err("problem sending internal payment", e.message);
    return res.code(500).send(e.message);
  }
};
