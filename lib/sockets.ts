import store from "$lib/store";
import jwt from "jsonwebtoken";
import { v4 } from "uuid";
import { err, warn } from "$lib/logging";
import { fail, getUser } from "$lib/utils";

const code = 1000;
const all = {};
const subscriptions = [];
const users = {};

export const emit = (uid, type, data) => {
  if (type === "payment" && data.amount > 0) {
    for (let i = subscriptions.length - 1; i >= 0; i--) {
      const s = subscriptions[i];

      if (s.invoice && s.invoice.id === data.iid) {
        s.ws.send(JSON.stringify({ type, data }));
      }
    }
  }

  if (!store.sockets[uid]) return;
  for (const id in store.sockets[uid]) {
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

  Object.values(all).map((ws: any) => {
    if (!sent.includes(ws.id)) ws.send(JSON.stringify({ type, data }));
  });
};

const track = async (ws, token) => {
  const { id } = ws;
  const { id: uid } = jwt.decode(token);

  if (!uid) fail("Invalid JWT token");
  const user = await getUser(uid);
  if (!user) fail(`User not found ${uid}`);

  if (!store.sockets[uid]) store.sockets[uid] = {};

  const existing = Object.keys(store.sockets[uid]);
  if (existing.length > 4) {
    const p = existing.find((sid) => sid !== uid);
    store.sockets[uid][p].close(code, "too many sockets");
  }

  store.sockets[uid][id] = ws;
  users[id] = uid;
  ws.user = user;
};

Bun.serve({
  hostname: "0.0.0.0",
  port: 3120,
  fetch(req, server) {
    // upgrade the request to a WebSocket
    if (server.upgrade(req)) {
      return; // do not return a Response
    }
    return new Response("Upgrade failed", { status: 500 });
  },
  websocket: {
    async message(ws: any, message: string) {
      let type;
      let data;

      try {
        ({ type, data } = JSON.parse(message));
      } catch (e) {
        err("coudn't parse socket message");
      }

      switch (type) {
        case "heartbeat":
          ws.beats = 0;
          try {
            if (data) await track(ws, data);
            ws.send(JSON.stringify({ type: "id", data: ws.id }));
          } catch (e) {
            // err("Failed to send heartbeat", e.message);
          }
          break;

        case "login":
          try {
            if (!data || data === "null" || !jwt.decode(data))
              return ws.close(code, `bad token ${data}`);

            await track(ws, data);
          } catch (e) {
            if (e.message.includes("not found"))
              ws.send(JSON.stringify({ type: "logout" }));
            setTimeout(
              () => ws?.close(code, `closing due to error ${e.message}`),
              1000,
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
          // warn("received socket message of unknown type", type, data);
      }
    },
    open(ws: any) {
      const id = v4();
      ws.id = id;
      ws.beats = 0;
      ws.send(JSON.stringify({ type: "connected", data: id }));
      all[id] = ws;
    },
    close(ws: any) {
      const { id } = ws;
      try {
        const uid = users[id];
        if (store.sockets[uid]?.[id]) {
          delete store.sockets[uid][id];
        }

        let i;
        ~(i = subscriptions.findIndex((s) => s.ws.id === id)) &&
          subscriptions.splice(i, 1);

        if (all[id]) delete all[id];
      } catch (e) {
        err("problem closing socket", e.message);
      }
    },
  },
});

export const sendHeartbeat = () => {
  for (const uid in store.sockets) {
    for (const id in store.sockets[uid]) {
      const ws = store.sockets[uid][id];
      ws.beats++;
      if (ws.beats > 10) ws.close(code, `${uid} ${id} lost heartbeat`);
    }
  }
};
