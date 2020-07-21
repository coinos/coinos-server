const WebSocket = require("ws");

module.exports = () => {
  binance = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@ticker");

  binance.onmessage = async function (event) {
    try {
      let msg = JSON.parse(event.data);

      let fx = app.get("fxrates");
      if (!fx) return;
      let rates = {};

      Object.keys(fx).map((symbol) => {
        rates[symbol] = msg.c * fx[symbol];
      });

      app.set("ask", msg.a);
      app.set("last", msg.l);
      app.set("balance", await lq.getBalance());
      app.set("rates", rates);
      checkQueue();
    } catch (e) {
      l.error("binance socket error", e.message);
    }
  };

  return binance;
};
