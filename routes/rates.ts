import { g } from "$lib/db";
import { rate } from "$lib/rates";

export default {
  async fx(c) {
    const { fx } = await g("fx");
    return c.json({ fx });
  },

  async last(c) {
    return c.json(rate || (await g("rate")));
  },

  async index(c) {
    const { date, fx, ...rates } = await g("rates");
    return c.json(rates);
  },
};
