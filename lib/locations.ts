import { err } from "$lib/logging";
import got from "got";
import { g, s } from "$lib/db";
import { fields, pick } from "$lib/utils";

export let getLocations = async () => {
  try {
    let last = await g("locations:last");
    let now = Date.now();

    if (now - last < 60000) return g("locations");
    let locations: Array<any> = await got(
      "https://api.btcmap.org/v2/elements?updated_since=2022-09-19T00:00:00Z",
    ).json();

    locations = locations.filter(
      (l) =>
        l["osm_json"].tags &&
        l["osm_json"].tags["payment:coinos"] === "yes" &&
        l["osm_json"].tags.name &&
        !l["deleted_at"],
    );

    locations.map((l) => {
      let { bounds, lat, lon } = l["osm_json"];

      l["osm_json"].lat = lat || (bounds.minlat + bounds.maxlat) / 2;
      l["osm_json"].lon = lon || (bounds.minlon + bounds.maxlon) / 2;
    });

    for await (let l of locations) {
      let username = l.tags["payment:coinos"];
      if (username) {
        let uid = await g(`user:${username}`);
        let user = await g(`user:${uid}`);
        if (user) l["osm_json"].tags.user = pick(user, fields);
      }
    }

    await s("locations", locations);
    await s("locations:last", now);
  } catch (e) {
    err("problem fetching locations", e);
  }

  setTimeout(getLocations, 60000);
};
