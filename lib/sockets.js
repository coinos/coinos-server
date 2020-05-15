const jwt = require("jsonwebtoken");
const uuidv4 = require("uuid/v4");
const WebSocket = require("ws");

wss = new WebSocket.Server({ clientTracking: false, noServer: true });

/* eslint-disable-next-line */
const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});
sockets = {};

emit = (username, type, data) => {
  if (data.username !== undefined) data = pick(data, ...whitelist);

  if (!sockets[username]) return;
  for (id in sockets[username]) {
    const ws = sockets[username][id];
    ws.send(JSON.stringify({ type, data }));
  } 
};

broadcast = (type, data) => {
  for (const username in sockets) {
    for (const id in sockets[username]) {
      const ws = sockets[username][id];
      ws.send(JSON.stringify({ type, data }));
    } 
  };
}

server.on("upgrade", function (request, socket, head) {
  wss.handleUpgrade(request, socket, head, function (ws) {
    wss.emit("connection", ws, request);
  });
});

const names = {};

wss.on("connection", function (ws) {
  const id = uuidv4();

  ws.on("message", async (token) => {
    if (!token) return;
    try {
      const username = jwt.decode(token).username;
      if (!sockets[username]) sockets[username] = {};
      sockets[username][id] = ws;
      names[id] = username;

      ws.send(JSON.stringify({ type: "networks", data: networks }));
      ws.send(JSON.stringify({ type: "rates", data: app.get("rates") }));
      ws.send(JSON.stringify({ type: "login", data: await getUser(username) }));
      l.info("socket open", username, id);
    } catch (e) {
      l.error("problem opening socket", token, e.message, id);
    }
  });

  ws.on("close", function () {
    const username = names[id];
    if (sockets[username][id] !== undefined) delete sockets[username][id];
    l.info("socket closed", username);
  });
});
