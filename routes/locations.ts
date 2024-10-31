import { g } from "$lib/db";

export default {
  async list(_, res) {
    const locations = await g("locations");
    res.send({ locations });
  },
};
