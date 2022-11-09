import config from "$config";
import db from "$db";
import bc from "$lib/bitcoin";
import { emit } from "$lib/sockets";
import store from "$lib/store";
import { notify } from "$lib/notifications";
import { callWebhook } from "$lib/webhooks";
import reverse from "buffer-reverse";
import zmq from "zeromq/v5-compat";
import { Op } from "@sequelize/core";
import { fromBase58 } from "bip32";
import bitcoin from "bitcoinjs-lib";
import { sendLiquid } from "$routes/liquid/send";
import { computeConversionFee } from "./conversionFee";
import { l, warn, err } from "$lib/logging";

const zmqRawBlock = zmq.socket("sub");
zmqRawBlock.connect(config.bitcoin.zmqrawblock);
zmqRawBlock.subscribe("rawblock");

const zmqRawTx = zmq.socket("sub");
zmqRawTx.connect(config.bitcoin.zmqrawtx);
zmqRawTx.subscribe("rawtx");

const network =
  bitcoin.networks[
    config.bitcoin.network === "mainnet" ? "bitcoin" : config.bitcoin.network
  ];

const queue = {};
const seen = [];

console.warn = () => {};

zmqRawTx.on("message", async (topic, message, sequence) => {
  try {
    const hex = message.toString("hex");
    let tx = bitcoin.Transaction.fromHex(message);

    let hash = reverse(tx.getHash()).toString("hex");

    if (seen.includes(hash)) return;
    seen.push(hash);
    if (seen.length > 5000) seen.shift();

    Promise.all(
      tx.outs.map(async o => {
        try {
          const { value } = o;

          let address;
          try {
            address = bitcoin.address.fromOutputScript(o.script, network);
          } catch (e) {
            return;
          }

          if (
            Object.keys(store.addresses).includes(address) &&
            !store.change.includes(address)
          ) {
            await db.transaction(async transaction => {
              let user = await db.User.findOne({
                where: {
                  username: store.addresses[address]
                },
                transaction
              });

              let invoice = await db.Invoice.findOne({
                where: {
                  address,
                  user_id: user.id,
                  network: "bitcoin"
                },
                order: [["id", "DESC"]],
                include: {
                  model: db.Account,
                  as: "account"
                },
                transaction
              });

              if (!invoice) return;

              const currency = invoice ? invoice.currency : user.currency;
              const rate = invoice ? invoice.rate : store.rates[user.currency];
              const tip = invoice ? invoice.tip : 0;
              const memo = invoice ? invoice.memo : "";

              let confirmed = false;

              let { account } = invoice;

              if (account.asset !== config.liquid.btcasset) {
                account = await db.Account.findOne({
                  where: {
                    user_id: user.id,
                    asset: config.liquid.btcasset,
                    pubkey: null
                  },
                  transaction
                });
              }

              await invoice.increment({ pending: value }, { transaction });
              await invoice.reload({ transaction });

              await account.increment({ pending: value }, { transaction });
              await account.reload({ transaction });

              if (config.bitcoin.walletpass)
                await bc.walletPassphrase(config.bitcoin.walletpass, 300);

              let totalOutputs = tx.outs.reduce((a, b) => a + b.value, 0);
              let totalInputs = 0;
              for (let i = 0; i < tx.ins.length; i++) {
                let { hash, index } = tx.ins[i];
                hash = reverse(hash).toString("hex");
                let hex = await bc.getRawTransaction(hash);
                let inputTx = bitcoin.Transaction.fromHex(hex);
                totalInputs += inputTx.outs[index].value;
              }
              let fee = totalInputs - totalOutputs;

              let payment = await db.Payment.create(
                {
                  account_id: account.id,
                  user_id: user.id,
                  hash,
                  fee,
                  memo,
                  amount: value - tip,
                  currency,
                  rate,
                  received: true,
                  tip,
                  confirmed,
                  address,
                  network: "bitcoin",
                  invoice_id: invoice.id
                },
                { transaction }
              );

              payment = payment.get({ plain: true });
              payment.account = account.get({ plain: true });
              payment.invoice = invoice.get({ plain: true });

              emit(user.username, "account", account);
              emit(user.username, "payment", payment);
              l("bitcoin detected", user.username, value);
              notify(user, `${value} SAT payment detected`);
              callWebhook(invoice, payment);
            });
          }
        } catch (e) {
          console.log("problem parsing bitcoin tx", e);
        }
      })
    );
  } catch (e) {
    console.log("problem receiving bitcoin tx", e);
  }
});

zmqRawBlock.on("message", async (topic, message, sequence) => {
  try {
    const payments = await db.Payment.findAll({
      where: { confirmed: false }
    });

    let block = bitcoin.Block.fromHex(message.toString("hex"));
    block.transactions.map(tx => {
      let hash = reverse(tx.getHash()).toString("hex");
      if (payments.find(p => p.hash === hash)) queue[hash] = 1;
    });
  } catch (e) {
    console.log(e);
  }
});

setInterval(async () => {
  try {
    const arr = Object.keys(queue);
    for (let i = 0; i < arr.length; i++) {
      const hash = arr[i];

      let account, address, invoice, user, total;
      await db.transaction(async transaction => {
        let payments = await db.Payment.findAll({
          where: { hash, confirmed: 0, received: 1 },
          include: [
            {
              model: db.Account,
              as: "account"
            },
            {
              model: db.Invoice,
              as: "invoice"
            },
            {
              model: db.User,
              as: "user"
            }
          ],
          lock: transaction.LOCK.UPDATE,
          transaction
        });

        for (let i = 0; i < payments.length; i++) {
          let p = payments[i];
          if (p && p.address) address = p.address;
          if (p && p.user) user = p.user;

          if (p && p.account) {
            ({ account, invoice } = p);
            total = p.amount + p.tip;

            p.confirmed = 1;
            await account.save({ transaction });

            await invoice.increment({ received: total }, { transaction });
            await invoice.decrement(
              { pending: Math.min(invoice.pending, total) },
              { transaction }
            );

            await account.increment({ balance: total }, { transaction });
            await account.decrement(
              { pending: Math.min(account.pending, total) },
              { transaction }
            );
            // get the # of fee credits you would need to pay off this amount of bitcoin
            await account.increment(
              { btc_credits: computeConversionFee(total) },
              { transaction }
            );
            await account.reload({ transaction });
            await invoice.reload({ transaction });
            await p.save({ transaction });

            p = p.get({ plain: true });
            p.account = account.get({ plain: true });
            p.invoice = invoice.get({ plain: true });

            emit(user.username, "account", account);
            emit(user.username, "payment", p);
            l("bitcoin confirmed", user.username, p.amount, p.tip);
            notify(user, `${total} SAT payment confirmed`);
            callWebhook(p.invoice, p);

            let c = store.convert[address];
            if (address && c) {
              l(
                "bitcoin detected to conversion address",
                address,
                c.address,
                user.username
              );
              user.account = account;

              sendLiquid({
                address: c.address,
                amount: total - 100,
                user,
                limit: total
              });
            }
          } else {
            warn("couldn't find bitcoin payment", hash);
          }
        }

        delete queue[hash];
      });
    }
  } catch (e) {
    err("problem processing queued bitcoin transaction", e.message, e.stack);
  }
}, 1000);
