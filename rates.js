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

      if (fx) {
        Object.keys(fx).map(symbol => {
          rates[symbol] = fx[symbol] / fx["USD"];
          if (symbol === "VEF") rates[symbol] *= 5;
        });

        app.set("rates", rates);
      } else {
        l("Problem fetching rates", res);
      }
    } catch (e) {
      l(e);
    }

    setTimeout(fetchRates, 180000);
  })();
};
