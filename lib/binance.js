const WebSocket = require("ws");

module.exports = () => {
  binance = new WebSocket("wss://fstream.binance.com/ws/btcusdt@ticker");

  binance.onmessage = async function (event) {
    try {
      let msg = JSON.parse(event.data);

      let fx = app.get("fxrates");
      if (!fx) return;
      let rates = {};

      Object.keys(fx).map((symbol) => {
        rates[symbol] = msg.c * fx[symbol];
      });

      app.set("rates", rates);
    } catch (e) {
      l.error("binance socket error", e);
    }
  };

  return binance;
};
