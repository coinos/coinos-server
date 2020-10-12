const BitcoinCore = require("bitcoin-core");
const lnd = require("../lib/lnd");
const { Op } = require("sequelize");
const { join } = require("path");
const fs = require("fs");
const read = require("../lib/read");

ah(async () => {
  seen = [];
  addresses = {};
  change = [];
  issuances = {};

  const exceptions = [];
  try {
    read(fs.createReadStream("exceptions"), (data) => exceptions.push(data));
  } catch (e) {
    l.warn("couldn't read exceptions file", e.message);
  }

  (await db.Invoice.findAll({
    include: {
      model: db.User,
      as: "user",
    },
  })).map(({ address, user, unconfidential }) => {
    if (address && user) addresses[address] = user.username;
    if (unconfidential && user) addresses[unconfidential] = user.username;
  });

  const accounts = await db.Account.findAll({
    where: { pubkey: { [Op.ne]: null } },
    include: {
      model: db.User,
      as: "user",
    },
  });

  accounts.map(({ address, user: { username } }) => {
    addresses[address] = username;
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
        l.warn("tx unconfirmed in db", tx.txid, tx.address);
      });

    const unaccounted = [];

    transactions.map((tx) => {
      if (!payments.includes(tx.txid) && !exceptions.includes(tx.txid)) {
        unaccounted.push(tx.txid);
      }
    });

    if (unaccounted.length)
      l.warn("wallet transactions missing from database", unaccounted);
  }, 720000);

  app.post("/send", auth, require("./send"));

  if (config.lna) {
    if (config.lna.clightning) {
      const lnapath = join(require("os").homedir(), ".lightningreg/regtest");
      lna = require("clightning-client")(lnapath);
    } else {
      lna = lnd(config.lna);
    }

    app.post("/lightning/channel", require("./lightning/channel"));
    app.post(
      "/lightning/channelRequest",
      require("./lightning/channelRequest")
    );
    app.post("/lightning/invoice", require("./lightning/invoice"));
    app.post("/lightning/query", auth, require("./lightning/query"));
    app.post("/lightning/send", auth, require("./lightning/send"));
    require("./lightning/receive");
  }

  if (config.bitcoin) {
    bc = new BitcoinCore(config.bitcoin);
    app.post(
      "/bitcoin/broadcast",
      optionalAuth,
      require("./bitcoin/broadcast")
    );
    app.get("/bitcoin/generate", auth, require("./bitcoin/generate"));
    app.post("/bitcoin/sweep", auth, require("./bitcoin/sweep"));
    app.post("/bitcoin/fee", auth, require("./bitcoin/fee"));
    app.post("/bitcoin/send", auth, require("./bitcoin/send"));
    require("./bitcoin/receive");

    setTimeout(async () => {
      const address = await bc.getNewAddress();
      const { hdkeypath } = await bc.getAddressInfo(address);
      const parts = hdkeypath.split('/');
      app.set("bcAddressIndex", parts[parts.length - 1].slice(0, -1));
    }, 50);
  }

  if (config.liquid) {
    lq = new BitcoinCore(config.liquid);
    app.post(
      "/liquid/broadcast",
      optionalAuth,
      require("./liquid/broadcast")
    );
    app.get("/liquid/generate", auth, require("./liquid/generate"));
    app.post("/liquid/fee", auth, require("./liquid/fee"));
    app.post("/liquid/send", auth, require("./liquid/send"));
    require("./liquid/receive");

    setTimeout(async () => {
      const address = await lq.getNewAddress();
      const { hdkeypath } = await lq.getAddressInfo(address);
      const parts = hdkeypath.split('/');
      app.set("lqAddressIndex", parts[parts.length - 1].slice(0, -1));
    }, 50);
  }

  app.get(
    "/payments",
    auth,
    ah(async (req, res) => {
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

  app.get(
    "/payment/:redeemcode",
    ah(async (req, res) => {
      try {
        const { redeemcode } = req.params;
        let payment = await db.Payment.findOne({
          where: {
            redeemcode,
          },
          include: {
            model: db.Account,
            as: "account",
          },
        });

        if (!payment) fail("invalid code");

        res.send(payment);
      } catch (e) {
        res.status(500).send(e.message);
      }
    })
  );
})();
