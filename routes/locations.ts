import { db, g } from "$lib/db";

export default {
  async list(c) {
    const locations = await g("locations");
    return c.json({ locations });
  },

  async nearby(c) {
    const lat = parseFloat(c.req.query("lat"));
    const lon = parseFloat(c.req.query("lon"));
    const radius = parseFloat(c.req.query("radius")) || 50;
    const count = parseInt(c.req.query("count")) || 50;

    if (isNaN(lat) || isNaN(lon)) {
      return c.json({ error: "lat and lon required" }, 400);
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

      return c.json({ locations });
    } catch (e) {
      console.log("nearby search failed", e);
      const locations = await g("locations");
      return c.json({ locations });
    }
  },
};
