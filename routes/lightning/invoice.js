import config from "config";
import { err } from "lib/logging";
import ln from "lib/ln";
import { v4 } from "uuid";

export default async (req, res) => {
  let { amount, memo, tip } = req.body;
  if (!tip) tip = 0;
  let value = amount + tip;

  try {
    if (!memo) memo = "coinos";
    const invoice = await ln.invoice(
      value ? `${value}sat` : "any",
      v4(),
      memo,
      360
    );
    res.send({ text: invoice.bolt11 });
  } catch (e) {
    console.log(e);
    err("problem creating invoice", e.message);
    res.code(500).send(e.message);
  }
};
