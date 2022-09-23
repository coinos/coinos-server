import app from "$app";
import axios from "axios";
import config from "$config";
import fs from "fs";
import binanceFactory from "./binance";
import { broadcast } from "./sockets";
import store from "./store";

const binance = binanceFactory();

let fetchRates;
(fetchRates = async () => {
  let date, fx;

  try {
    ({ date, fx } = JSON.parse(fs.readFileSync("fx")));
  } catch (e) {
    warn("Failed to read fx file");
  }

  let today = JSON.stringify(new Date())
    .replace(/T.*/, "")
    .replace(/"/, "");

  if (date !== today) {
    try {
      let {
        data: { rates: fx }
      } = await axios.get(`https://api.exchangerate.host/latest?base=USD&v={(new Date()).toISOString().split('T')[0]}`);
      fs.writeFileSync("fx", JSON.stringify({ date, fx }));
    } catch (e) {
      try {
        let {
          data: { rates: fx }
        } = await axios.get(
          `http://data.fixer.io/api/latest?access_key=${config.fixer}`
        );

        let USD = fx["USD"];
        Object.keys(fx).map(k => {
          fx[k] = parseFloat((fx[k] / fx["USD"]).toFixed(6));
        });

        fs.writeFileSync("fx", JSON.stringify({ date, fx }));
      } catch (e) {
        err("error fetching rates", e.message);
      }
    }
  }

  store.fx = fx;

  setTimeout(fetchRates, 7200000);
})();

app.get("/rates", async (req, res, next) => {
  res.send(store.rates);
});

setInterval(() => {
  broadcast("rate", store.last);
}, 1000);
