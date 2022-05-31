const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const WebSocket = require("ws");
const { differenceInSeconds, subSeconds } = require("date-fns");


wss = new WebSocket.Server({ clientTracking: false, noServer: true });

/* eslint-disable-next-line */
const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});
const all = {};
const subscriptions = [];
const lastSeen = {};

emit = (username, type, data) => {
  if (data.username !== undefined) data = pick(data, ...whitelist);

  if (type === "payment" && data.amount > 0) {
    for (let i = subscriptions.length - 1; i >= 0; i--) {
      let s = subscriptions[i];
      if (
        s.invoice.amount === data.amount ||
        (data.address && s.invoice.address === data.address) ||
        (data.address && s.invoice.unconfidential === data.address)
      ) {
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
  const sent = [];
  for (const username in sockets) {
    for (const id in sockets[username]) {
      const ws = sockets[username][id];
      ws.send(JSON.stringify({ type, data }));
      sent.push(ws.id);
    }
  }

  Object.values(all).map(ws => {
    if (!sent.includes(ws.id)) ws.send(JSON.stringify({ type, data }));
  });
};

server.on("upgrade", function(req, socket, head) {
  wss.handleUpgrade(req, socket, head, function(ws) {
    wss.emit("connection", ws, req);
  });
});

const names = {};

setInterval(() => {
  for (const username in sockets) {
    for (const id in sockets[username]) {
      let ws = sockets[username][id];
      ws.beats++;
      if (ws.beats > 10) ws.close();
    }
  }
}, 2000);

wss.on("connection", function(ws, req) {
  const id = uuidv4();
  ws.id = id;
  ws.beats = 0;
  ws.send(JSON.stringify({ type: "connected", data: id }));
  all[id] = ws;

  ws.on("message", async message => {
    let type, data;
    try {
      ({ type, data } = JSON.parse(message));
    } catch (e) {
      l.error("coudn't parse socket message");
    }

    switch (type) {
      case "heartbeat":
        ws.beats = 0;
        if (ws.user) emit(ws.user.username, "id", ws.id);
        break;

      case "login":
        let token = data;

        if (differenceInSeconds(new Date(), lastSeen[token]) < 5) return;
        lastSeen[token] = new Date();

        try {
          if (!token || token === "null" || !jwt.decode(token)) return ws.close();
          const username = jwt.decode(token).username;
          if (!username) throw new Error("Invalid JWT token");

          if (!sockets[username]) sockets[username] = {};
          const existing = Object.keys(sockets[username]);
          if (existing.length > 4) {
            const p = existing.find(sid => sid !== id);
            sockets[username][p].send(JSON.stringify({ type: "logout" }));
            setTimeout(() => {
              if (sockets[username][p]) sockets[username][p].close();
            }, 5000);
          }
          sockets[username][id] = ws;
          names[id] = username;

          let user = await getUser(username);
          if (user.locked) throw new Error("Account is locked");
          let payments = await user.getPayments({
            where: {
              account_id: user.account_id
            },
            order: [["id", "DESC"]],
            limit: 12,
            include: [{
              model: db.Account,
              as: "account"
            },
            {
              model: db.Payment,
              as: "fee_payment"
            }]
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
          l.error("caught socket error", e.message);
          if (e.message.includes("locked")) {
            ws.send(JSON.stringify({ type: "locked" }));
            ws.send(JSON.stringify({ type: "logout" }));
          }
          if (e.message.includes("not found"))
            ws.send(JSON.stringify({ type: "logout" }));
          setTimeout(() => ws && ws.close(), 1000);
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
            id: data.id
          },
          include: {
            model: db.Account,
            as: "account"
          }
        });
        if (payment) {
          payment.memo = data.memo;
          await payment.save();
          emit(ws.user.username, "payment", payment);
        }
        break;
      case "subscribe":
        subscriptions.push({ invoice: data, ws });
        break;
      default:
        l.warn("received socket message of unknown type", type, data);
    }
  });

  ws.on("close", function() {
    try {
      const username = names[id];
      if (sockets[username] && sockets[username][id]) {
        delete sockets[username][id];
      }

      if (all[id]) delete all[id];
    } catch (e) {
      l.error("problem closing socket", e.message);
    }
  });
});
