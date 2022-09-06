import { lnurlServer } from "$lnurl.js";

export default async (req, res) => {
  let { localAmt, pushAmt } = req.body;

  pushAmt = 0;

  try {
    if (localAmt < 20000)
      throw new Error("amount must be greater than 20000 SAT");
    if (localAmt > 1000000) throw new Error("amount must be <= 1000000");

    const result = await lnurlServer.generateNewUrl("channelRequest", {
      localAmt,
      pushAmt
    });

    res.send(result);
  } catch (e) {
    err("problem generating channel request", e.message);
    res.status(500).send(e.message);
  }
};
