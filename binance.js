const WebSocket = require("ws");

module.exports = (app, socket) => {
  const binance = new WebSocket(
    "wss://stream.binance.com:9443/ws/btcusdt@ticker"
  );

  binance.onmessage = async function(event) {
    let msg = JSON.parse(event.data);
    app.set("bid", msg.b);
    app.set("ask", msg.a);
    app.set("last", msg.l);

    let fx = app.get("rates");
    if (!fx) return;
    let rates = {};

    Object.keys(fx).map(symbol => {
      rates[symbol] = msg.a * fx[symbol];
    });

    socket.emit("rates", rates);
  };
};
