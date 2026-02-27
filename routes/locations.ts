import { db, g } from "$lib/db";

export default {
  async list(_, res) {
    const locations = await g("locations");
    res.send({ locations });
  },

  async nearby(req, res) {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const radius = parseFloat(req.query.radius) || 50;
    const count = parseInt(req.query.count) || 50;

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).send({ error: "lat and lon required" });
    }

    try {
      const ids = await db.geoSearch("locations:geo", {
        longitude: lon,
        latitude: lat,
      }, {
        radius,
        unit: "km",
      }, {
        COUNT: count,
        SORT: "ASC",
      });

      const locations = [];
      for (const id of ids) {
        const loc = await g(`location:${id}`);
        if (loc) locations.push(loc);
      }

      res.send({ locations });
    } catch (e) {
      console.log("nearby search failed", e);
      const locations = await g("locations");
      res.send({ locations });
    }
  },
};
