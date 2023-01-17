import { err } from "$lib/logging";
import sendInternal from "$lib/sendInternal";
import { requirePin } from "$lib/auth";

export default async (req, res, next) => {
  try {
    await requirePin(req);
    let payment = await sendInternal(req.body, req.user);
    res.send(payment);
  } catch (e) {
    console.log(e)
    err("problem sending internal payment", e.message);
    return res.code(500).send(e.message);
  }
};
