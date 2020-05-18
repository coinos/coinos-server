const WebSocket = require("ws");

module.exports = () => {
  l.info("connecting to binance");
  binance = new WebSocket(
    "wss://stream.binance.com:9443/ws/btcusdt@ticker"
  );

  binance.onopen = function(event) {
    l.info("binance socket opened");
  };

  binance.onerror = function(event) {
    l.error("binance socket error", event);
  };

  binance.onmessage = async function(event) {
    l.info("got rates from binance");
    try {
      let msg = JSON.parse(event.data);
      app.set("bid", msg.b);
      app.set("ask", msg.a);
      app.set("last", msg.l);

      let fx = app.get("fxrates");
      if (!fx) return;
      let rates = {};

      Object.keys(fx).map(symbol => {
        rates[symbol] = msg.a * fx[symbol];
      });

      app.set("rates", rates);
      l.info("saved binance rates");
    } catch(e) {
      l.error("binance socket error", e);
    } 
  };

  return binance;
};
