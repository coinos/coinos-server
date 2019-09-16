const WebSocket = require("ws");

module.exports = app => {
  const binance = new WebSocket(
    "wss://stream.binance.com:9443/ws/btcusdt@ticker"
  );

  binance.onmessage = async function(event) {
    let msg = JSON.parse(event.data);
    app.set("bid", msg.b);
    app.set("ask", msg.a);
    app.set("last", msg.l);
  };
};
