const BitcoinCore = require("bitcoin-core");
const lnd = require("../lib/lnd");
const { Op } = require("sequelize");
const { join } = require("path");
const fs = require("fs");
const read = require("../lib/read");

(async () => {
  seen = [];
  addresses = {};
  issuances = {};

  const exceptions = [];
  try {
    read(fs.createReadStream("exceptions"), (data) => exceptions.push(data));
  } catch (e) {
    l.warn("couldn't read exceptions file", e.message);
  }

  await db.User.findAll({
    attributes: ["username", "address", "liquid"],
  }).map((u) => {
    if (u.address) addresses[u.address] = u.username;
    if (u.liquid) addresses[u.liquid] = u.username;
  });

  await db.Invoice.findAll({
    include: [
      {
        model: db.User,
        as: "user",
      },
    ],
  }).map((i) => {
    if (i.address && i.user) addresses[i.address] = i.user.username;
    if (i.unconfidential && i.user)
      addresses[i.unconfidential] = i.user.username;
  });

  payments = (
    await db.Payment.findAll({
      attributes: ["hash"],
    })
  ).map((p) => p.hash);

  setInterval(async () => {
    const unconfirmed = (
      await db.Payment.findAll({
        where: {
          confirmed: 0,
        },
      })
    ).map((p) => p.address);

    const transactions = await bc.listTransactions("*", 1000);

    transactions
      .filter(
        (tx) =>
          tx.category === "receive" &&
          tx.confirmations > 0 &&
          unconfirmed.includes(tx.address)
      )
      .map((tx) => {
        l.warn("tx unconfirmed in db", tx.txid);
      });

    const unaccounted = [];

    transactions.map((tx) => {
      if (!payments.includes(tx.txid) && !exceptions.includes(tx.txid)) {
        unaccounted.push(tx.txid);
      }
    });

    if (unaccounted.length)
      l.warn("wallet transactions missing from database", unaccounted);
  }, 60000);

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

    app.post("/lightning/channel", require("./lightning/channel"));
    app.post(
      "/lightning/channelRequest",
      require("./lightning/channelRequest")
    );
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

  app.get(
    "/payments",
    auth,
    ah(async (req, res, next) => {
      let payments = await req.user.getPayments({
        where: {
          account_id: req.user.account_id,
        },
        order: [["id", "DESC"]],
        include: {
          model: db.Account,
          as: "account",
        },
      });

      res.send(payments);
    })
  );
})();
