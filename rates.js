const axios = require("axios");
const config = require("./config");
const l = console.log;

module.exports = app => {
  let fetchRates;
  (fetchRates = async () => {
    try {
      let rates = {};
      let res = await axios.get(
        `http://data.fixer.io/api/latest?access_key=${config.fixer}`
      );

      let fx = res.data.rates;

      Object.keys(fx).map(symbol => {
        rates[symbol] = fx[symbol] / fx["USD"];
      });

      app.set("rates", rates);
    } catch (e) {
      l(e);
    }

    setTimeout(fetchRates, 180000);
  })();
};
