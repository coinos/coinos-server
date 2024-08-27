import { g } from "$lib/db";

export default {
  async last(req, res) {
    res.send(await g('rate'));
  },

  async index(req, res) {
    res.send(await g('rates'));
  },
};
