const axios = require("axios");
const lnurl = require("lnurl");
const jwt = require("jsonwebtoken");

logins = {};

lnurlServer = lnurl.createServer(config.lnurl);

var optionalAuth = function(req, res, next) {
  passport.authenticate('jwt', { session: false }, function(err, user, info) {
    req.user = user;
    next();
  })(req, res, next);
};

app.get("/loginUrl", optionalAuth, async (req, res) => {
  try {
    const result = await lnurlServer.generateNewUrl("login");

    if (req.user) {
      logins[result.secret] = req.user.username;
    }

    res.send(result);
  } catch (e) {
    l.error(e.message);
    res.status(500).send(e.message);
  }
});

app.get("/decode", async (req, res) => {
  const { text } = req.query;

  try {
    const decoded = lnurl.decode(text);
    let result = await axios.get(decoded);
    res.send(result.data);
  } catch (e) {
    l.error(e.message);
    res.status(500).send(e.message);
  }
});

lnurlServer.bindToHook("login", async params => {
  try {
    const { k1, key } = params;

    const exists = await db.Key.findOne({
      where: { hex: key },
      include: [{model: db.User, as: "user" }]
    });

    let user;
    if (logins[k1]) {
      const username = logins[k1];
      user = await db.User.findOne({
        where: { username }
      });

      const k = await db.Key.create({
        user_id: user.id,
        hex: key,
      });

      l.info("added key", username, k);
      emit(username, 'key', k);
    } 
    else if (exists) ({ user } = exists); 
    else return;

    if (user && user.username) {
      const payload = { username: user.username };
      const token = jwt.sign(payload, config.jwt);
      const ws = sessions[k1];
      if (ws && ws.send)
        ws.send(JSON.stringify({ type: "token", data: token }));
    }
  } catch (e) {
    l.error(e.message);
  }
});
