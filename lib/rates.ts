import got from "got";
import config from "$config";
import store from "$lib/store";
import { err, warn } from "$lib/logging";
import { g, s } from "$lib/db";
import { sleep } from "$lib/utils";
import WebSocket from "ws";

let last;
let ws;
let connect = async () => {
  if (ws && ws.readyState === 1 && Date.now() - last < 5000) return;
  if (ws) ws.terminate() && (await sleep(Math.round(Math.random() * 1000)));

  ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@ticker");

  ws.onmessage = async function (event) {
    try {
      let msg = JSON.parse(event.data);
      let rates = await g("rates");
      let fx = await g("fx");
      if (fx) ({ fx } = fx);

      Object.keys(fx).map((symbol) => {
        rates[symbol] = msg.c * fx[symbol];
      });

      s("rate", msg.c);
      s("rates", rates);
      last = Date.now();
    } catch (e) {
      console.log(e);
      err("binance message error", e.message);
    }
  };

  ws.onerror = async function (error) {
    err("binance socket error", error.message);
  };

  return ws;
};

export let getFx = async () => {
  connect();

  let date = 0,
    fx = await g("fx");
  if (fx) ({ date, fx } = fx);

  if (Date.now() - date > 24 * 60 * 60 * 1000) {
    date = Date.now();
    try {
      let r = await got(
        `http://data.fixer.io/api/latest?access_key=${config.fixer}`,
      ).json();
      let { rates: fx } = r;
      let USD = fx["USD"];

      Object.keys(fx).map((k) => {
        fx[k] = fx[k] / USD;
      });

      await s("fx", { date, fx });
    } catch (e) {
      err("error fetching rates", e.message);
    }
  }

  setTimeout(getFx, 30000);
};
