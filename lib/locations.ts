import { g, s } from "$lib/db";
import { err } from "$lib/logging";
import { fields, pick } from "$lib/utils";
import got from "got";

const dedup = (array) =>
  Object.values(
    array.reduce((acc, obj) => {
      if (
        !acc[obj.id] ||
        new Date(obj.updated_at) > new Date(acc[obj.id].updated_at)
      ) {
        acc[obj.id] = obj;
      }
      return acc;
    }, {}),
  );

export const getLocations = async () => {
  try {
    const previous = await g("locations") || [];
    let since = await g("locations:since");
    if (!since) since = "2022-09-19T00:00:00Z";
    if (Date.now() - new Date(since).getTime() < 60000) return;

    let locations: Array<any> = await got(
      `https://api.btcmap.org/v2/elements?updated_since=${since}`,
    ).json();

    locations = locations.filter(
      (l) =>
        l.osm_json.tags &&
        l.osm_json.tags["payment:coinos"] === "yes" &&
        l.osm_json.tags.name &&
        !l.deleted_at,
    );

    locations.map((l) => {
      const { bounds, lat, lon } = l.osm_json;

      l.osm_json.lat = lat || (bounds.minlat + bounds.maxlat) / 2;
      l.osm_json.lon = lon || (bounds.minlon + bounds.maxlon) / 2;
    });

    for await (const l of locations) {
      const username = l.tags["payment:coinos"];
      if (username) {
        const uid = await g(`user:${username}`);
        const user = await g(`user:${uid}`);
        if (user) l.osm_json.tags.user = pick(user, fields);
      }
    }

    locations.push(...previous);

    await s("locations", dedup(locations));
    await s("locations:since", `${new Date().toISOString().split(".")[0]}Z`);
  } catch (e) {
    console.log(e);
    err("problem fetching locations", e);
  }

  setTimeout(getLocations, 60000);
};
