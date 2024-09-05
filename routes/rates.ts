import { g } from "$lib/db";

export default {
  async fx(_, res) {
    let { fx } = await g("fx");
    res.send({fx});
  },

  async last(_, res) {
    res.send(await g("rate"));
  },

  async index(_, res) {
    res.send(await g("rates"));
  },
};
