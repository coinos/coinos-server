import app from "app";
import got from "got";
import config from "config";
import fs from "fs";
import binance from "./binance";
import { broadcast } from "./sockets";
import store from "./store";
import { err, warn } from "lib/logging";

let b = binance();
setInterval(() => {
  b.terminate();
  b = binance();
}, 360000);

let fetchRates = async () => {
  let date, fx;

  try {
    ({ date, fx } = JSON.parse(fs.readFileSync("data/fx")));
  } catch (e) {
    warn("Failed to read fx file");
  }

  let today = JSON.stringify(new Date())
    .replace(/T.*/, "")
    .replace(/"/, "");

  if (date !== today) {
    try {
      let { rates: fx } = await got(
        `https://api.exchangerate.host/latest?base=USD&v={(new Date()).toISOString().split('T')[0]}`
      ).json();
      fs.writeFileSync("data/fx", JSON.stringify({ date, fx }));
    } catch (e) {
      try {
        let { rates: fx } = await got(
          `http://data.fixer.io/api/latest?access_key=${config.fixer}`
        ).json();

        let USD = fx["USD"];
        Object.keys(fx).map(k => {
          fx[k] = parseFloat((fx[k] / fx["USD"]).toFixed(6));
        });

        fs.writeFileSync("data/fx", JSON.stringify({ date, fx }));
      } catch (e) {
        err("error fetching rates", e.message);
      }
    }
  }

  store.fx = fx;

  setTimeout(fetchRates, 7200000);
};
fetchRates();

app.get("/rate", async (req, res, next) => {
  res.send(store.last);
});

app.get("/rates", async (req, res, next) => {
  res.send(store.rates);
});

setInterval(() => {
  broadcast("rate", store.last);
}, 1000);
