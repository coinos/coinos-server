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

  payments = (
    await db.Payment.findAll({
      attributes: ["hash"]
    })
  ).map(p => p.hash);

  app.post("/send", auth, require("./send"));

  if (config.lna) {
    if (config.lna.clightning) {
      const lnapath = join(require("os").homedir(), ".lightningreg/regtest");
      const lnbpath = join(require("os").homedir(), ".lightningregb/regtest");
      lna = require("clightning-client")(lnapath);
      lnb = require("clightning-client")(lnbpath);
    } else {
      lna = lnd(config.lna);
      lnb = lnd(config.lnb);
    }

    app.get("/lightning/decode", require("./lightning/decode"));
    app.post("/lightning/channel", auth, require("./lightning/channel"));
    app.post("/lightning/channelRequest", auth, require("./lightning/channelRequest"));
    app.post("/lightning/invoice", auth, require("./lightning/invoice"));
    app.post("/lightning/query", auth, require("./lightning/query"));
    app.post("/lightning/send", auth, require("./lightning/send"));
    require("./lightning/receive");
  }

  if (config.bitcoin) {
    bc = new BitcoinCore(config.bitcoin);
    app.get("/bitcoin/generate", auth, require("./bitcoin/generate"));
    app.post("/bitcoin/sweep", auth, require("./bitcoin/sweep"));
    app.post("/bitcoin/fee", auth, require("./bitcoin/fee"));
    app.post("/bitcoin/send", auth, require("./bitcoin/send"));
    require("./bitcoin/receive");
  }

  if (config.liquid) {
    lq = new BitcoinCore(config.liquid);
    app.get("/liquid/generate", auth, require("./liquid/generate"));
    app.post("/liquid/fee", auth, require("./liquid/fee"));
    app.post("/liquid/send", auth, require("./liquid/send"));
    require("./liquid/receive");
  }

  app.get("/payments", auth, async (req, res) => {
    let payments = await req.user.getPayments({
      where: {
        account_id: req.user.account_id
      },
      order: [["id", "DESC"]],
      include: {
        model: db.Account,
        as: "account"
      }
    });

    res.send(payments);
  });
})();
