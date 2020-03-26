const BitcoinCore = require("bitcoin-core");
const lnd = require("../lib/lnd");
const { Op } = require("sequelize");

(async () => {
  bc = new BitcoinCore(config.bitcoin);
  lq = new BitcoinCore(config.liquid);

  lna = lnd(config.lna);
  lnb = lnd(config.lnb);

  seen = [];
  addresses = {};
  await db.User.findAll({
    attributes: ["username", "address", "liquid"]
  }).map(u => {
    addresses[u.address] = u.username;
    if (u.liquid) addresses[u.liquid] = u.username;
  });

  payments = (await db.Payment.findAll({
    attributes: ["hash"]
  })).map(p => p.hash);

  app.post("/lightning/invoice", auth, require("./lightning/invoice"));
  app.post("/lightning/query", auth, require("./lightning/query"));
  app.post("/lightning/send", auth, require("./lightning/send"));
  app.post("/lightning/user", auth, require("./lightning/user"));
  require("./lightning/receive");

  app.post("/bitcoin/send", auth, require("./bitcoin/send"));
  app.post("/bitcoin/fee", auth, require("./bitcoin/fee"));
  require("./bitcoin/receive");

  app.post("/liquid/send", auth, require("./liquid/send"));
  app.post("/liquid/fee", auth, require("./liquid/fee"));
  require("./liquid/receive");

  app.get("/payments", auth, async (req, res) => {
    const payments = await db.Payment.findAll({
      where: { 
        user_id: req.user.id,
        [Op.or]: {
          received: true,
          amount: {
            [Op.lt]: 0,
          },
        }, 
      },
      order: [["id", "DESC"]]
    });

    emit(req.user.username, "payments", payments);
    res.send(payments);
  });
})();
