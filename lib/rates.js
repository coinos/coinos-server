const axios = require("axios");

let binance = require("./binance")();

let fetchRates;
(fetchRates = async () => {
  let rates = require("./devrates");

  if (process.env.NODE_ENV === "production") {
    try {
      let res = await axios.get(
        `http://data.fixer.io/api/latest?access_key=${config.fixer}`
      );

      let fx = res.data.rates;

      fx &&
        Object.keys(fx).map(symbol => {
          rates[symbol] = fx[symbol] / fx["USD"];
        });
    } catch (e) {
      l.error("error fetching rates", e);
    }
  }

  app.set("fxrates", rates);

  setTimeout(fetchRates, 7200000);
})();

setInterval(() => {
  broadcast("rates", app.get("rates"));
}, 1000);

setInterval(() => {
  binance.terminate();
  binance = require("./binance")();
}, 360000);
