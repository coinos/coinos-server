import app from "$app";
import WebSocket from "ws";
import { err } from "./logging";
import store from "./store";

export default () => {
  const binance = new WebSocket(
    "wss://stream.binance.com:9443/ws/btcusdt@ticker"
  );

  binance.onmessage = async function(event) {
    try {
      let msg = JSON.parse(event.data);

      if (!store.fx) return;

      Object.keys(store.fx).map(symbol => {
        store.rates[symbol] = msg.c * store.fx[symbol];
      });

      // app.set("ask", msg.a);
      // app.set("bid", msg.b);
      last = msg.c;
    } catch (e) {
      err("binance message error", e.message);
    }
  };

  binance.onerror = async function(error) {
    err("binance socket error", error);
  };

  return binance;
};
