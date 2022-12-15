import app from "$app";
import redis from "$lib/redis";
import axios from "axios";

let locations;
app.get("/locations", async (req, res) => {
  res.send({ locations });
});

let getLocations = async () => {
  let { data } = await axios.get(
    "https://api.btcmap.org/v2/elements?updated_since=2022-09-19"
  );
  locations = data.filter(
    l => l["osm_json"].tags && l["osm_json"].tags["payment:coinos"] === "yes"
  );

  setTimeout(getLocations, 60000);
};

getLocations();
