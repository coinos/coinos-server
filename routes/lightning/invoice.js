import config from "$config";
import { createInvoice } from "lightning";
import { err } from "$lib/logging";
import lnd from "$lib/lnd";
import ln from "$lib/ln";

export default async (req, res) => {
  let { amount, memo, tip } = req.body;
  if (!tip) tip = 0;
  let value = amount + tip;

  try {
    if (config.lna.clightning) {
      if (!memo) memo = "coinos";
      const invoice = await ln.invoice(
        value ? `${value}sat` : "any",
        new Date(),
        memo,
        360
      );
      res.send({ text: invoice.bolt11 });
    } else {
      const invoice = await createInvoice({
        lnd,
        tokens: value,
        description: memo
      });
      res.send({ text: invoice.request });
    }
  } catch (e) {
    console.log(e)
    err("problem creating invoice", e.message);
    res.code(500).send(e.message);
  }
};
