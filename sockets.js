import jwt from "jsonwebtoken";
import io from "socket.io";
import whitelist from "./whitelist";

/* eslint-disable-next-line */
const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});
const l = console.log;

module.exports = (app, db, server) => {
  const socket = io(server, { origins: "*:*" });
  const sids = {};

  socket.use((socket, next) => {
    try {
      let token = socket.handshake.query.token;
      let user = jwt.decode(token).username;
      socket.request.user = user;
      sids[user] ? sids[user].push(socket.id) : (sids[user] = [socket.id]);
      sids[socket.id] = user;
    } catch (e) {
      l(e);
    }
    next();
  });

  socket.sockets.on("connect", async socket => {
    socket.emit("connected");
    if (app.get("rates")) socket.emit("rate", app.get("rates").ask);
    socket.on("getuser", async (data, callback) => {
      /* eslint-disable-next-line */
      callback(
        await db.User.findOne({
          where: {
            username: socket.request.user
          }
        })
      );
    });

    socket.on("disconnect", s => {
      let user = sids[socket.id];
      sids[user].splice(sids[user].indexOf(socket.id), 1);
      delete sids[socket.id];
    });
  });

  const emit = (username, msg, data) => {
    if (data.username !== undefined) data = pick(data, ...whitelist);

    if (!sids[username]) return;
    sids[username].map((sid, i) => {
      try {
        socket.to(sid).emit(msg, data);
      } catch (e) {
        sids[username].splice(i, 1);
      }
    });
  };

  return [socket, emit];
};
