const axios = require("axios");

let binance = require("./binance")();

let fetchRates;
(fetchRates = async () => {
  let fx = require("./devrates");

  if (prod) {
    try {
      let res = await axios.get(
        `http://data.fixer.io/api/latest?access_key=${config.fixer}`
      );

      fx = res.data.rates;

      fx &&
        Object.keys(fx).map(symbol => {
          rates[symbol] = fx[symbol] / fx["USD"];
        });
    } catch (e) {
      l.error("error fetching rates", e);
    }
  }

  app.set("fx", fx);

  setTimeout(fetchRates, 7200000);
})();

setInterval(() => {
  broadcast("rate", app.get("last"));
}, 1000);

setInterval(() => {
  binance.terminate();
  binance = require("./binance")();
}, 360000);
