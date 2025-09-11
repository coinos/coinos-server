import { g } from "$lib/db";
import { rate } from "$lib/rates";

export default {
  async fx(_, res) {
    const { fx } = await g("fx");
    res.send({ fx });
  },

  async last(_, res) {
    res.send(rate || (await g("rate")));
  },

  async index(_, res) {
    const { date, fx, ...rates } = await g("rates");
    res.send(rates);
  },
};
