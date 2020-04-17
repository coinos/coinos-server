const axios = require("axios");

app.get("/assets", async (req, res) => {
  let assets;
  try {
    assets = await axios.get("https://assets.blockstream.info/");
    res.send(assets.data);
  } catch(e) {
    l.error("error fetching assets", e);
    res.status(500).send("error fetching assets");
  } 
});
