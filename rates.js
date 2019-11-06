const axios = require("axios");
const config = require("./config");
const l = console.log;

module.exports = (app, socket) => {
  let binance = require("./binance")(app, socket);

  let fetchRates;
  (fetchRates = async () => {
    try {
      let rates = {};
      let res = await axios.get(
        `http://data.fixer.io/api/latest?access_key=${config.fixer}`
      );

      let fx = res.data.rates;

      fx &&
        Object.keys(fx).map(symbol => {
          rates[symbol] = fx[symbol] / fx["USD"];
        });

      res = await axios.get(
        "https://api.bitcoinvenezuela.com/?html=no&currency=VEF"
      );

      rates.VEF = res.data["exchange_rates"].VEF_USD;
      rates.VES = res.data["exchange_rates"].VEF_USD / 100000;
      rates.KVES = res.data["exchange_rates"].VEF_USD / 100000000;

      app.set("fxrates", rates);
    } catch (e) {
      l(e);
    }

    setTimeout(fetchRates, 7200000);
  })();

  setInterval(() => {
    socket.emit("rates", app.get("rates"));
  }, 1000);

  setInterval(() => {
    binance.terminate();
    binance = require("./binance")(app, socket);
  }, 360000);
};
