import { g } from "$lib/db";

export default {
  async list(_, res) {
    let locations = await g("locations");
    res.send({ locations });
  },
};
