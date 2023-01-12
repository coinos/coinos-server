import store from "lib/store";
import config from "config";
import app from "app";
import jwt from "jsonwebtoken";
import { v4 } from "uuid";
import WebSocket from "ws";
import { differenceInSeconds, subSeconds } from "date-fns";
import fastifyWs from "@fastify/websocket";
import whitelist from "./whitelist";
import { l, err, warn } from "lib/logging";
import { getUser } from "lib/utils";

const code = 1000;

const wss = new WebSocket.Server({ clientTracking: false, noServer: true });

const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});
const all = {};
const subscriptions = [];
const lastSeen = {};

export const emit = (uuid, type, data) => {
  if (data.uuid !== undefined) data = pick(data, ...whitelist);

  if (type === "payment" && data.amount > 0) {
    for (let i = subscriptions.length - 1; i >= 0; i--) {
      let s = subscriptions[i];

      if (s.invoice.id === data.invoice_id) {
        s.ws.send(JSON.stringify({ type, data }));
      }
    }
  }

  if (!store.sockets[uuid]) return;
  for (let id in store.sockets[uuid]) {
    const ws = store.sockets[uuid][id];
    ws.send(JSON.stringify({ type, data }));
  }
};

export const broadcast = (type, data) => {
  const sent = [];
  for (const uuid in store.sockets) {
    for (const id in store.sockets[uuid]) {
      const ws = store.sockets[uuid][id];
      ws.send(JSON.stringify({ type, data }));
      sent.push(ws.id);
    }
  }

  Object.values(all).map(ws => {
    if (!sent.includes(ws.id)) ws.send(JSON.stringify({ type, data }));
  });
};

function subtractSeconds(numOfSeconds, date = new Date()) {
  date.setSeconds(date.getSeconds() - numOfSeconds);

  return date;
}

app.register(fastifyWs);
app.register(async function(app) {
  app.get("/ws", { websocket: true }, ({ socket: ws }, req) => {
    const id = v4();
    ws.id = id;
    ws.beats = 0;
    ws.send(JSON.stringify({ type: "connected", data: id }));
    all[id] = ws;

    ws.on("message", async message => {
      let type, data;
      try {
        ({ type, data } = JSON.parse(message));
      } catch (e) {
        err("coudn't parse socket message");
      }

      switch (type) {
        case "heartbeat":
          ws.beats = 0;
          ws.send(JSON.stringify({ type: "id", data: ws.id }));
          break;

        case "login":
          let token = data;
          if (lastSeen[token] > subtractSeconds(5)) return;
          lastSeen[token] = new Date();

          try {
            if (!token || token === "null" || !jwt.decode(token))
              return ws.close(code, `bad token ${token}`);

            let { uuid } = jwt.decode(token);
            if (!uuid) throw new Error("Invalid JWT token");
            console.log("UUID", uuid)
            let user = await getUser(uuid);
            if (!user) throw new Error("User not found");

            if (!store.sockets[uuid]) store.sockets[uuid] = {};
            const existing = Object.keys(store.sockets[uuid]);
            if (existing.length > 4) {
              const p = existing.find(sid => sid !== id);
              store.sockets[uuid][p].send(JSON.stringify({ type: "logout" }));
              setTimeout(() => {
                if (store.sockets[uuid][p])
                  store.sockets[uuid][p].close(code, "too many sockets");
              }, 5000);
            }
            store.sockets[uuid][id] = ws;
            names[id] = uuid;

            ws.user = user;
            ws.send(
              JSON.stringify({ type: "login", data: pick(user, ...whitelist) })
            );
            ws.send(
              JSON.stringify({ type: "version", data: config.clientVersion })
            );
          } catch (e) {
            console.log(e)
            err("caught socket error", e.message);
            if (e.message.includes("not found"))
              ws.send(JSON.stringify({ type: "logout" }));
            setTimeout(
              () => ws && ws.close(code, `closing due to error ${e.message}`),
              1000
            );
          }
          break;
        case "token":
          if (!ws.user) return;
          ws.token = data;
          break;
        case "lnurl":
          store.sessions[data] = ws;
          break;
        case "subscribe":
          subscriptions.push({ invoice: data, ws });
          break;
        default:
          warn("received socket message of unknown type", type, data);
      }
    });

    ws.on("close", function(code, reason) {
      try {
        const uuid = names[id];
        if (store.sockets[uuid] && store.sockets[uuid][id]) {
          delete store.sockets[uuid][id];
        }

        if (all[id]) delete all[id];
      } catch (e) {
        err("problem closing socket", e.message);
      }
    });
  });
});

const names = {};

setInterval(() => {
  for (const uuid in store.sockets) {
    for (const id in store.sockets[uuid]) {
      let ws = store.sockets[uuid][id];
      ws.beats++;
      if (ws.beats > 10) ws.close(code, `${uuid} ${id} lost heartbeat`);
    }
  }
}, 2000);
