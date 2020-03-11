const jwt = require("jsonwebtoken");
const io = require("socket.io");
const whitelist = require("./whitelist");
const Sequelize = require("sequelize");

/* eslint-disable-next-line */
const pick = (O, ...K) => K.reduce((o, k) => ((o[k] = O[k]), o), {});
const l = require("pino")();;

module.exports = (app, db, server) => {
  const socket = io(server, { origins: "*:*" });
  const sids = {};

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

  socket.use((socket, next) => {
    try {
      let token = socket.handshake.query.token;
      let user = jwt.decode(token).username;
      socket.request.user = user;
      sids[user] ? sids[user].push(socket.id) : (sids[user] = [socket.id]);
      sids[socket.id] = user;
    } catch (e) {
      l.error("error creating socket", e);
    }
    next();
  });

  socket.sockets.on("connect", async socket => {
    socket.emit("connected");
    if (app.get("rates")) socket.emit("rate", app.get("rates").ask);
    socket.on("getuser", async (data, callback) => {
      l.info(`logging in ${socket.request.user}`);
      const user = await db.User.findOne({
        include: [
          {
            model: db.Payment,
            as: "payments",
            order: [["id", "DESC"]],
            received: { 
              [Sequelize.Op.ne]: null
            },
            limit: 12
          }
        ],
        where: {
          username: socket.request.user
        }
      });

      callback(user);
    });

    socket.on("disconnect", s => {
      let user = sids[socket.id];
      l.info("logging out", user);
      sids[user].splice(sids[user].indexOf(socket.id), 1);
      delete sids[socket.id];
    });
  });

  return [socket, emit];
};
