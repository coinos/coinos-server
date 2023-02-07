import got from "got";
import config from "$config";
import { broadcast } from "$lib/sockets";
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

  ws.onmessage = async function(event) {
    try {
      let msg = JSON.parse(event.data);

      Object.keys(store.fx).map(symbol => {
        store.rates[symbol] = msg.c * store.fx[symbol];
      });

      store.last = msg.c;
      last = Date.now();
    } catch (e) {
      console.log(e);
      err("binance message error", e.message);
    }
  };

  ws.onerror = async function(error) {
    err("binance socket error", error.message);
  };

  return ws;
};

export let sendRates = () => broadcast("rate", store.last);
export let getRates = async () => {
  connect();

  let date = 0,
    fx;
  let rates = await g("rates");
  if (rates) ({ date, fx } = rates);

  if (Date.now() - date > 24 * 60 * 60 * 1000) {
    date = Date.now();
    try {
      let { rates: fx } = await got(
        `https://api.exchangerate.host/latest?base=USD&v={(new Date()).toISOString().split('T')[0]}`
      ).json();
      await s("rates", { date, fx });
    } catch (e) {
      err("error fetching rates", e.message);
    }
  }

  store.fx = fx;

  setTimeout(getRates, 30000);
};
