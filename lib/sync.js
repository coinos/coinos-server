const { differenceInDays } = require("date-fns");
const fs = require("fs");
const read = require("../lib/read");
const { Op } = require("sequelize");

const init = async () => {
  try {
    read(fs.createReadStream("exceptions"), data => exceptions.push(data));
  } catch (e) {
    l.warn("couldn't read exceptions file", e.message);
  }

  try {
    const twoDays = new Date(new Date().setDate(new Date().getDate() - 2));

    (
      await db.Invoice.findAll({
        where: {
          createdAt: {
            [Op.gt]: twoDays
          }
        },
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
};

init();

const sync = async () => {
  const twoWeeksAgo = new Date(new Date().setDate(new Date().getDate() - 14));
  const payments = await db.Payment.findAll({
    attributes: ["hash", "confirmed", "preimage"],
    where: { createdAt: { [Op.gt]: twoWeeksAgo } },
    include: [
      {
        model: db.Account,
        as: "account"
      },
      {
        model: db.User,
        as: "user"
      }
    ]
  });

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

    const unconfirmed = await db.Payment.findAll({
      where: {
        confirmed: 0
      },
      include: [
        {
          model: db.Account,
          as: "account"
        },
        {
          model: db.User,
          as: "user"
        }
      ]
    });

    let hashes = unconfirmed.map(p => p.hash);

    const transactions = [
      ...(await bc.listTransactions("*", 50)),
      ...(await lq.listTransactions("*", 50))
    ].filter(tx => ["send", "receive"].includes(tx.category));

    missed = transactions.filter(
      tx =>
        tx.category === "receive" &&
        tx.confirmations > 2 &&
        hashes.includes(tx.txid)
    );

    for (let i = 0; i < missed.length; i++) {
      let p = unconfirmed.find(p => p.hash === missed[i].txid);
      /*
      p.confirmed = 1;

      await db.transaction(async transaction => {
        await p.save({ transaction });

        await p.account.increment({ balance: p.amount }, { transaction });
        await p.account.decrement({ pending: p.amount }, { transaction });
      });

      emit(p.user.username, "account", p.account);
      emit(p.user.username, "payment", p);
      */

      l.info("unconfirmed tx", p.user_id, p.hash, p.address);
    }

    unaccounted = [];

    transactions.map(tx => {
      if (
        !payments.find(p => p.hash === tx.txid) &&
        !exceptions.includes(tx.txid)
      ) {
        unaccounted.push(tx);
      }
    });

    if (unaccounted.length)
      l.warn(
        "wallet transactions missing from database",
        unaccounted.map(tx => tx.txid)
      );

    let receipts = unaccounted
      .filter(
        tx => tx.category === "receive" && tx.asset === config.liquid.btcasset
      )
      .map(tx => tx.address);

    invoices = await db.Invoice.findAll({
      where: {
        [Op.or]: {
          address: receipts,
          unconfidential: receipts
        }
      },
      include: [
        {
          model: db.Account,
          as: "account"
        },
        {
          model: db.User,
          as: "user"
        }
      ]
    });

    for (let i = 0; i < invoices.length; i++) {
      let {
        address,
        unconfidential,
        account,
        account_id,
        currency,
        id: invoice_id,
        network,
        rate,
        tip,
        user,
        user_id
      } = invoices[i];

      let { amount, txid: hash } = unaccounted.find(
        tx => tx.address === address || tx.address === unconfidential
      );

      amount = toSats(amount);

      await db.transaction(async transaction => {
        payments.push(hash);
        let p = await db.Payment.create(
          {
            account_id,
            address: address || unconfidential,
            amount,
            confirmed: false,
            currency,
            hash,
            invoice_id,
            network,
            rate,
            received: true,
            tip,
            user_id
          },
          { transaction }
        );

        await account.increment({ pending: amount }, { transaction });

        emit(user.username, "account", account);
        emit(user.username, "payment", p);
      });
    }
  } catch (e) {
    l.error("sync check failed", e.message, e.stack);
  }

  setTimeout(sync, 300000);
};

setTimeout(sync, 5000);

app.get(
  "/conversions",
  ah(async (req, res) => {
    const transactions = [
      ...(await bc.listTransactions("*", 500)),
      ...(await lq.listTransactions("*", 500))
    ].filter(tx => ["receive"].includes(tx.category));

    const { addr } = req.query;
    const { invoices } = require("./invoices");
    const persist = require("./persist");
    let conversions = persist("data/conversions.json");
    const payments = (
      await db.Payment.findAll({
        attributes: ["hash"]
      })
    ).map(p => p.hash);
    res.send(
      Object.keys(conversions)
        .filter(c => conversions[c].address === addr)
        .filter(c => {
          return (
            invoices.find(
              i => i.payment_request === c && i.state === "SETTLED"
            ) || transactions.find(tx => tx.txid === c)
          );
        })
        .filter(c => !payments.includes(c))
    );
  })
);
