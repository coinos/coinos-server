const bodyParser = require("body-parser");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const BitcoinCore = require("bitcoin-core");
const cors = require("cors");
const express = require("express");
const graphqlHTTP = require("express-graphql");
const morgan = require("morgan");

const config = require("./config");

const l = console.log;

(async () => {
  const bc = new BitcoinCore(config.bitcoin);
  const app = express();
  app.enable("trust proxy");
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(bodyParser.json());
  app.use(cookieParser());
  app.use(cors({ credentials: true, origin: "http://*:*" }));
  app.use(compression());
  app.use(morgan("combined"));

  const server = require("http").Server(app);
  const db = await require("./db");
  const [socket, emit] = require("./sockets")(app, db, server);
  const passport = require("./passport")(db);
  const auth = passport.authenticate("jwt", { session: false });

  app.use(passport.initialize());

  app.use(
    "/graphql",
    auth,
    graphqlHTTP({
      schema: db.gqlschema,
      graphiql: true
    })
  );

  require("./binance")(app);
  require("./kraken")(app, socket);

  const seen = [];
  const addresses = {};
  await db.User.findAll({
    attributes: ["username", "address"]
  }).map(u => {
    addresses[u.address] = u.username;
  });

  const payments = (await db.Payment.findAll({
    attributes: ["hash"]
  })).map(p => p.hash);

  app.get("/rates", (req, res) => {
    res.send(app.get("rates"));
  });

  require("./payments")(app, auth, addresses, bc, db, emit, seen, payments);
  require("./users")(addresses, auth, app, bc, db, emit);
  require("./stripe")(auth, app, db, emit);

  app.get("/balance/:address", require("./addressBalance"));

  app.use(function(err, req, res, next) {
    res.status(500);
    res.send("An error occurred");
    l(err.stack);
    return res.end();
  });

  server.listen(config.port, () =>
    console.log(`CoinOS Server listening on port ${config.port}`)
  );
})();
