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
    res.send(await g("rates"));
  },
};
