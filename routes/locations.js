import app from "app";
import redis from "lib/redis";
import got from "got";

let locations = [];
app.get("/locations", async (req, res) => {
  res.send({ locations });
});

let getLocations = async () => {
  try {
  let r = await got(
    "https://api.btcmap.org/v2/elements?updated_since=2022-09-19"
  ).json();
  locations = r.filter(
    l => l["osm_json"].tags && l["osm_json"].tags["payment:coinos"] === "yes"
  );
  } catch(e) {} 

  setTimeout(getLocations, 60000);
};

getLocations();
