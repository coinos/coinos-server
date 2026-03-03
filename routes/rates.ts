import { g } from "$lib/db";
import { rate } from "$lib/rates";

export default {
  async fx(c) {
    const { fx } = await g("fx");
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ fx });
  },

  async last(c) {
    c.header("Cache-Control", "public, max-age=30");
    return c.json(rate || (await g("rate")));
  },

  async index(c) {
    const { date, fx, ...rates } = await g("rates");
    c.header("Cache-Control", "public, max-age=30");
    return c.json(rates);
  },
};
