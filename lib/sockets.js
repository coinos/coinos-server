import app from "$app";
import config from "$config";
import store from "$lib/store";
import jwt from "jsonwebtoken";
import { v4 } from "uuid";
import whitelist from "./whitelist";
import { l, err, warn } from "$lib/logging";
import { g } from "$lib/db";
import { pick } from "$lib/utils";

const code = 1000;
const all = {};
const subscriptions = [];
const lastSeen = {};
const users = {};

export const emit = (uid, type, data) => {
  if (type === "payment" && data.amount > 0) {
    for (let i = subscriptions.length - 1; i >= 0; i--) {
      let s = subscriptions[i];

      if (s.hash === data.hash) {
        s.ws.send(JSON.stringify({ type, data }));
      }
    }
  }

  if (!store.sockets[uid]) return;
  for (let id in store.sockets[uid]) {
    const ws = store.sockets[uid][id];
    ws.send(JSON.stringify({ type, data }));
  }
};

export const broadcast = (type, data) => {
  const sent = [];
  for (const uid in store.sockets) {
    for (const id in store.sockets[uid]) {
      const ws = store.sockets[uid][id];
      ws.send(JSON.stringify({ type, data }));
      sent.push(ws.id);
    }
  }

  Object.values(all).map(ws => {
    if (!sent.includes(ws.id)) ws.send(JSON.stringify({ type, data }));
  });
};

export async function socketServer(app) {
  let seconds = (n, d = new Date()) => d.setSeconds(d.getSeconds() - n) && d;

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
          if (lastSeen[token] > seconds(5)) return;
          lastSeen[token] = new Date();

          try {
            if (!token || token === "null" || !jwt.decode(token))
              return ws.close(code, `bad token ${token}`);

            let { id: uid } = jwt.decode(token);
            if (!uid) throw new Error("Invalid JWT token");
            let user = await g(`user:${uid}`);
            console.log("uid", uid)
            if (!user) throw new Error("User not found");

            if (!store.sockets[uid]) store.sockets[uid] = {};
            const existing = Object.keys(store.sockets[uid]);
            if (existing.length > 4) {
              const p = existing.find(sid => sid !== uid);
              store.sockets[uid][p].send(JSON.stringify({ type: "logout" }));
              setTimeout(() => {
                if (store.sockets[uid][p])
                  store.sockets[uid][p].close(code, "too many sockets");
              }, 5000);
            }
            store.sockets[uid][id] = ws;
            users[id] = uid;

            ws.user = user;
            ws.send(
              JSON.stringify({ type: "login", data: pick(user, whitelist) })
            );
            ws.send(
              JSON.stringify({ type: "version", data: config.clientVersion })
            );
          } catch (e) {
            console.log(e);
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
        const uid = users[id];
        if (store.sockets[uid] && store.sockets[uid][id]) {
          delete store.sockets[uid][id];
        }

        if (all[id]) delete all[id];
      } catch (e) {
        err("problem closing socket", e.message);
      }
    });
  });
}

export let sendHeartbeat = () => {
  for (const uid in store.sockets) {
    for (const id in store.sockets[uid]) {
      let ws = store.sockets[uid][id];
      ws.beats++;
      if (ws.beats > 10) ws.close(code, `${uid} ${id} lost heartbeat`);
    }
  }
};
