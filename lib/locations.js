import got from "got";
import { s } from "$lib/db";

export let getLocations = async () => {
  try {
    let locations = await got(
      "https://api.btcmap.org/v2/elements?updated_since=2022-09-19"
    ).json();

    locations = locations.filter(
      l =>
        l["osm_json"].tags &&
        l["osm_json"].tags["payment:coinos"] === "yes" &&
        l["osm_json"]["type"] === "node"
    );

    await s("locations", locations);
  } catch (e) {}

  setTimeout(getLocations, 60000);
};
