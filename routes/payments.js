const BitcoinCore = require("@asoltys/bitcoin-core");
const { Op } = require("sequelize");
const { join } = require("path");
const fs = require("fs");
const read = require("../lib/read");
const { differenceInDays } = require("date-fns");

ah(async () => {
  seen = [];
  addresses = {};
  change = [];
  issuances = {};

  const exceptions = [];
  try {
    read(fs.createReadStream("exceptions"), data => exceptions.push(data));
  } catch (e) {
    l.warn("couldn't read exceptions file", e.message);
  }

  try {
    (
      await db.Invoice.findAll({
        include: {
          model: db.User,
          as: "user"
        }
      })
    ).map(({ address, user, unconfidential }) => {
      if (address && user) addresses[address] = user.username;
      if (unconfidential && user) addresses[unconfidential] = user.username;
    });
  } catch (e) {
    console.log(e);
  }

  try {
    const accounts = await db.Account.findAll({
      where: { pubkey: { [Op.ne]: null } },
      include: {
        model: db.User,
        as: "user"
      }
    });

    accounts.map(({ address, user: { username } }) => {
      addresses[address] = username;
    });
  } catch (e) {
    console.log(e);
  }

  payments = (
    await db.Payment.findAll({
      attributes: ["hash"]
    })
  ).map(p => p.hash);

  const sanity = async () => {
    try {
      let { invoices } = await lnp.listInvoices({
        reversed: true,
        num_max_invoices: 1000
      });

      let recent = invoices
        .filter(
          i =>
            i.settled &&
            differenceInDays(new Date(), new Date(i.settle_date * 1000)) < 2
        )
        .map(i => ({
          amount: parseInt(i.amt_paid_sat),
          preimage: i.r_preimage.toString("hex"),
          pr: i.payment_request.toString("hex"),
          createdAt: new Date(i.settle_date * 1000)
        }));

      const twoDaysAgo = new Date(new Date().setDate(new Date().getDate() - 2));
      let settled = (
        await db.Payment.findAll({
          where: { network: "lightning", createdAt: { [Op.gt]: twoDaysAgo } },
          attributes: ["preimage"]
        })
      ).map(p => p.preimage);

      let missed = recent.filter(i => !settled.includes(i.preimage));
      for (let i = 0; i < missed.length; i++) {
        let { amount, preimage, pr: text, createdAt } = missed[i];
        let invoice = await db.Invoice.findOne({
          where: { text },
          include: {
            model: db.User,
            as: "user"
          }
        });

        if (invoice && invoice.user_id) {
          let account = await db.Account.findOne({
            where: {
              user_id: invoice.user_id,
              asset: config.liquid.btcasset,
              pubkey: null
            }
          });

          if (account) {
            let payment = await db.Payment.create({
              account_id: account.id,
              user_id: invoice.user_id,
              hash: text,
              amount,
              currency: invoice.currency,
              preimage,
              rate: invoice.rate,
              received: true,
              confirmed: true,
              network: "lightning",
              tip: invoice.tip,
              invoice_id: invoice.id,
              createdAt,
              updatedAt: createdAt
            });

            await account.increment({ balance: amount });

            l.info("rectified account", account.id, amount);
          }
        }
      }

      const unconfirmed = (
        await db.Payment.findAll({
          where: {
            confirmed: 0
          }
        })
      ).map(p => p.hash);

      const transactions = [
        ...(await bc.listTransactions("*", 1000)),
        ...(await lq.listTransactions("*", 1000))
      ];

      transactions
        .filter(
          tx =>
            tx.category === "receive" &&
            tx.confirmations > 0 &&
            unconfirmed.includes(tx.txid)
        )
        .map(tx => {
          l.warn("tx unconfirmed in db", tx.txid, tx.address);
        });

      const unaccounted = [];

      transactions.map(tx => {
        if (!payments.includes(tx.txid) && !exceptions.includes(tx.txid)) {
          unaccounted.push(tx.txid);
        }
      });

      if (unaccounted.length)
        l.warn("wallet transactions missing from database", unaccounted);

      let s = fs.createWriteStream("exceptions", { flags: "a" });
      unaccounted.map(tx => s.write(tx + "\n"));
    } catch (e) {
      l.error("sanity check failed", e.message);
    }
  };

  setTimeout(sanity, 5000);
  setInterval(sanity, 720000);

  app.post("/send", auth, require("./send"));

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
})();
