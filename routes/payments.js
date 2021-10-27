const fs = require("fs");
const BitcoinCore = require("@asoltys/bitcoin-core");
const { join } = require("path");

app.post("/send", auth, require("./send"));
app.get(
  "/except",
  adminAuth,
  ah((req, res) => {
    let s = fs.createWriteStream("exceptions", { flags: "a" });
    unaccounted.map(tx => s.write(tx.txid + "\n"));
    l.info("updated exceptions");
    res.send("updated exceptions");
  })
);

if (config.lna) {
  if (config.lna.clightning) {
    lna = require("clightning-client")(config.lna.dir);
  } else {
    const lnd = require("../lib/lnd");
    lna = lnd.default;
    lnp = [
      "addInvoice",
      "channelBalance",
      "connectPeer",
      "decodePayReq",
      "getInfo",
      "listInvoices",
      "listPayments",
      "sendPaymentSync",
      "walletBalance"
    ].reduce(
      (a, b) =>
        (a[b] = args => new Promise(r => lna[b](args, (e, v) => r(v)))) && a,
      {}
    );
  }

  app.post("/lightning/channel", require("./lightning/channel"));
  app.post("/lightning/channelRequest", require("./lightning/channelRequest"));
  app.post("/lightning/invoice", require("./lightning/invoice"));
  app.post("/lightning/query", auth, require("./lightning/query"));
  app.post("/lightning/send", auth, require("./lightning/send"));
  require("./lightning/receive");
}

if (config.bitcoin) {
  bc = new BitcoinCore(config.bitcoin);
  app.post("/bitcoin/broadcast", optionalAuth, require("./bitcoin/broadcast"));
  app.get("/bitcoin/generate", auth, require("./bitcoin/generate"));
  app.post("/bitcoin/sweep", auth, require("./bitcoin/sweep"));
  app.post("/bitcoin/fee", auth, require("./bitcoin/fee"));
  app.post("/bitcoin/send", auth, require("./bitcoin/send"));
  require("./bitcoin/receive");

  setTimeout(async () => {
    try {
      const address = await bc.getNewAddress();
      const { hdkeypath } = await bc.getAddressInfo(address);
      const parts = hdkeypath.split("/");
      app.set("bcAddressIndex", parts[parts.length - 1].slice(0, -1));
    } catch (e) {
      console.error(e);
    }
  }, 50);
}

if (config.liquid) {
  lq = new BitcoinCore(config.liquid);
  rare = new BitcoinCore(config.rare);
  app.post("/liquid/broadcast", optionalAuth, require("./liquid/broadcast"));
  app.get("/liquid/generate", auth, require("./liquid/generate"));
  app.post("/liquid/fee", auth, require("./liquid/fee"));
  app.post("/liquid/send", auth, require("./liquid/send"));
  app.post("/taxi", auth, require("./liquid/taxi"));
  require("./liquid/receive");

  setTimeout(async () => {
    try {
      const address = await lq.getNewAddress();
      const { hdkeypath } = await lq.getAddressInfo(address);
      const parts = hdkeypath.split("/");
      app.set("lqAddressIndex", parts[parts.length - 1].slice(0, -1));
    } catch (e) {
      l.warn("Problem getting liquid address index", e.message);
    }
  }, 50);
}

app.get(
  "/payments",
  auth,
  ah(async (req, res) => {
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
  })
);

app.get(
  "/payment/:redeemcode",
  ah(async (req, res) => {
    try {
      const { redeemcode } = req.params;
      let payment = await db.Payment.findOne({
        where: {
          redeemcode
        },
        include: {
          model: db.Account,
          as: "account"
        }
      });

      if (!payment) fail("invalid code");

      res.send(payment);
    } catch (e) {
      res.status(500).send(e.message);
    }
  })
);
