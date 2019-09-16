const axios = require("axios");
const l = console.log;

module.exports = (app, socket) => {
  let fetchRates;
  (fetchRates = async () => {
    try {
      let res = await axios.get(
        "https://api.kraken.com/0/public/Ticker?pair=XBTCAD"
      );
      let ask = res.data.result.XXBTZCAD.c[0];
      let now = new Date();
      let ts = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
      // l(ts, "kraken ask:", ask);
      app.set("rates", { ask });
      socket.emit("rate", ask);
    } catch (e) {
      l(e);
    }

    setTimeout(fetchRates, 3000);
  })();
};
