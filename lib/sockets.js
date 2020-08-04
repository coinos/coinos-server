const jwt = require("jsonwebtoken");
const uuidv4 = require("uuid/v4");
const WebSocket = require("ws");

wss = new WebSocket.Server({ clientTracking: false, noServer: true });

/* eslint-disable-next-line */
const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});
const subscriptions = [];

emit = (username, type, data) => {
  if (data.username !== undefined) data = pick(data, ...whitelist);

  if (type === "payment" && data.amount > 0) {
    for (let i = subscriptions.length - 1; i >= 0; i--) {
      let s = subscriptions[i];
      if (s.invoice.amount === data.amount || s.invoice.address === data.address || s.invoice.unconfidential === data.address) {
        s.ws.send(JSON.stringify({ type, data }));
        subscriptions.splice(i, 1);
      }
    }
  }

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
  }
};

server.on("upgrade", function (req, socket, head) {
  wss.handleUpgrade(req, socket, head, function (ws) {
    wss.emit("connection", ws, req);
  });
});

const names = {};

wss.on("connection", function (ws, req) {
  const id = uuidv4();
  ws.send(JSON.stringify({ type: "connected" }));

  ws.on("message", async (message) => {
    let type, data;
    try {
      ({ type, data } = JSON.parse(message));
    } catch (e) {
      l.error("coudn't parse socket message");
    }

    switch (type) {
      case "login":
        let token = data;
        if (!token || token === "null") return;
        try {
          const username = jwt.decode(token).username;
          if (!sockets[username]) sockets[username] = {};
          const existing = Object.keys(sockets[username]);
          if (existing.length > 5) {
            l.warn("too many sockets, logging out", existing[3]);
            sockets[username][existing[3]].send(
              JSON.stringify({ type: "login", data: false })
            );
          }
          sockets[username][id] = ws;
          names[id] = username;

          let user = await getUser(username);
          let payments = await user.getPayments({
            where: {
              account_id: user.account_id,
            },
            order: [["id", "DESC"]],
            limit: 12,
            include: {
              model: db.Account,
              as: "account",
            },
          });
          let accounts = await user.getAccounts();
          let keys = await user.getKeys();
          user = user.get({ plain: true });
          user.accounts = accounts;
          user.keys = keys;
          user.payments = payments;

          ws.user = user;
          ws.send(JSON.stringify({ type: "login", data: user }));
          ws.send(
            JSON.stringify({ type: "version", data: config.clientVersion })
          );
        } catch (e) {
          ws.close();
          l.error(
            "problem opening socket",
            token,
            e.message,
            id,
            req.connection.remoteAddress
          );
        }
        break;
      case "token":
        if (!ws.user) return;
        ws.token = data;
        break;
      case "lnurl":
        sessions[data] = ws;
        break;
      case "updateMemo":
        const payment = await db.Payment.findOne({
          where: {
            user_id: ws.user.id,
            id: data.id,
          },
          include: {
            model: db.Account,
            as: "account",
          },
        });
        if (payment) {
          payment.memo = data.memo;
          await payment.save();
          emit(ws.user.username, "payment", payment);
        }
        break;
      case "subscribe":
        l.info("subscribe", data.amount);
        subscriptions.push({ invoice: data, ws });
        break;
      default:
        l.warn("received socket message of unknown type", type, data);
    }
  });

  ws.on("close", function () {
    try {
      const username = names[id];
      if (sockets[username] && sockets[username][id])
        delete sockets[username][id];
    } catch (e) {
      l.error("problem closing socket", e.message);
    }
  });
});
