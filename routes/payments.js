const BitcoinCore = require("bitcoin-core");
const lnd = require("../lib/lnd");
const { Op } = require("sequelize");
const { join } = require("path");

(async () => {
  seen = [];
  addresses = {};
  issuances = {};

  await db.User.findAll({
    attributes: ["username", "address", "liquid"]
  }).map(u => {
    if (u.address) addresses[u.address] = u.username;
    if (u.liquid) addresses[u.liquid] = u.username;
  });

  payments = (await db.Payment.findAll({
    attributes: ["hash"]
  })).map(p => p.hash);

  app.post("/send", auth, require("./send"));

  if (config.lna) {
    if (config.lna.clightning) {
      const lnapath = join(require('os').homedir(), '.lightningreg/regtest')
      const lnbpath = join(require('os').homedir(), '.lightningregb/regtest')
      lna = require('clightning-client')(lnapath);
      lnb = require('clightning-client')(lnbpath);
    } else {
      lna = lnd(config.lna);
      lnb = lnd(config.lnb);
    }

    app.post("/lightning/invoice", auth, require("./lightning/invoice"));
    app.post("/lightning/query", auth, require("./lightning/query"));
    app.post("/lightning/send", auth, require("./lightning/send"));
    require("./lightning/receive");
  }

  if (config.bitcoin) {
    bc = new BitcoinCore(config.bitcoin);
    app.post("/bitcoin/sweep", auth, require("./bitcoin/sweep"));
    app.post("/bitcoin/fee", auth, require("./bitcoin/fee"));
    app.post("/bitcoin/send", auth, require("./bitcoin/send"));
    require("./bitcoin/receive");
  }

  if (config.liquid) {
    lq = new BitcoinCore(config.liquid);
    app.post("/liquid/fee", auth, require("./liquid/fee"));
    app.post("/liquid/send", auth, require("./liquid/send"));
    require("./liquid/receive");
  }

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
