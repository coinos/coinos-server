import store from "$lib/store";

export default {
  async last(req, res) {
    res.send(store.last);
  },

  async index(req, res) {
    res.send(store.rates);
  },
};
