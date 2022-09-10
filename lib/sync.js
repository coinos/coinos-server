import config from "$config";
import { toSats } from "$lib/utils";
import { emit } from "$lib/sockets";
import db from "$db/db";
import app from "$app";
import { differenceInDays } from "date-fns";
import fs from "fs";
import read from "./read";
import { Op } from "@sequelize/core";
import store from "./store";
import { l, err, warn } from "./logging";
import lnd from "./lnd";
import { getInvoices } from "lightning";
import bc from "./bitcoin";
import lq from "./liquid";

const init = async () => {
  try {
    read(fs.createReadStream("exceptions"), data =>
      store.exceptions.push(data)
    );
  } catch (e) {
    warn("couldn't read exceptions file", e.message);
  }

  try {
    const thirtyDays = new Date(new Date().setDate(new Date().getDate() - 30));

    (
      await db.Invoice.findAll({
        where: {
          createdAt: {
            [Op.gt]: thirtyDays
          }
        },
        include: {
          model: db.User,
          as: "user"
        }
      })
    ).map(({ address, user, unconfidential }) => {
      if (address && user) store.addresses[address] = user.username;
      if (unconfidential && user)
        store.addresses[unconfidential] = user.username;
    });
  } catch (e) {
    console.log(e);
  }

  store.payments = (
    await db.Payment.findAll({
      attributes: ["hash"]
    })
  ).map(p => p.hash);
};

init();

const sync = async () => {
  const twoWeeksAgo = new Date(new Date().setDate(new Date().getDate() - 14));

  try {
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

    let { invoices } = await getInvoices({ lnd, limit: 1000 });

    let recent = invoices
      .filter(
        i =>
          i.is_confirmed &&
          differenceInDays(new Date(), new Date(i.created_at)) < 2
      )
      .map(i => ({
        amount: parseInt(i.received),
        preimage: i.secret,
        pr: i.request,
        createdAt: new Date(i.created_at)
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
      if (!text || !text.length) continue;

      try {
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

            l("lightning missing from account", account.id, amount);
          }
        }
      } catch (e) {
        err(
          "problem syncing lightning payment",
          JSON.stringify(missed[i]),
          e.message,
          e.stack
        );
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
      ...(await bc.listTransactions("*", 500)),
      ...(await lq.listTransactions("*", 500))
    ].filter(
      tx =>
        ["send", "receive"].includes(tx.category) &&
        new Date(tx.time * 1000) > twoWeeksAgo
    );

    missed = transactions.filter(
      tx =>
        tx.category === "receive" &&
        tx.confirmations > 2 &&
        hashes.includes(tx.txid)
    );

    for (let i = 0; i < missed.length; i++) {
      let p = unconfirmed.find(p => p.hash === missed[i].txid);
      p.confirmed = 1;

      try {
        await db.transaction(async transaction => {
          await p.save({ transaction });

          await p.account.increment({ balance: p.amount }, { transaction });
          await p.account.decrement({ pending: p.amount }, { transaction });
        });

        emit(p.user.username, "account", p.account);
        emit(p.user.username, "payment", p);

        l("unconfirmed tx", p.user_id, p.hash, p.address);
      } catch (e) {
        err("problem confirming payment", p, e.message, e.stack);
      }
    }

    store.unaccounted = [];

    transactions.map(tx => {
      if (
        !payments.find(p => p.hash === tx.txid) &&
        !store.exceptions.includes(tx.txid) &&
        !store.unaccounted.find(a => a.txid === tx.txid) &&
        new Date(tx.blocktime * 1000) >= twoWeeksAgo
      ) {
        store.unaccounted.push(tx);
      }
    });

    if (store.unaccounted.length)
      warn(
        "wallet transactions missing from database",
        store.unaccounted.map(tx => tx.txid)
      );

    let receipts = store.unaccounted
      .filter(
        tx =>
          tx.category === "receive" &&
          (!tx.asset || tx.asset === config.liquid.btcasset)
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

      l("unaccounted", address);

      let pending = store.unaccounted.filter(
        tx => tx.address === address || tx.address === unconfidential
      );

      for (let i = 0; i < pending.length; i++) {
        let { amount, txid: hash } = pending[i];

        amount = toSats(amount);

        try {
          await db.transaction(async transaction => {
            l("found pending transaction", user.username, amount, hash);
            store.payments.push(hash);
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
        } catch (e) {
          err("problem updating pending transaction", hash, e.message, e.stack);
        }
      }
    }
  } catch (e) {
    console.log(e);
    err("sync check failed", e.message, e.stack);
  }

  setTimeout(sync, 300000);
};

setTimeout(sync, 5000);

app.get("/conversions", async (req, res) => {
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
});
