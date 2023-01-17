import { g } from "$lib/db";

export default {
async list(req, res) {
  res.send({ locations: await g('locations') });
}
}
