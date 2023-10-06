import { g } from "$lib/db";

export default {
  async list(req, res) {
    let locations = await g("locations");
    res.send({ locations });
  }
};
