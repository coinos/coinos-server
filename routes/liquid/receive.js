import db from "$db";
import config from "$config";
import { getBlockHeight, getUser, getUserById, toSats, SATS } from "$lib/utils";
import { emit } from "$lib/sockets";
import store from "$lib/store";
import { sendLiquid } from "$routes/liquid/send";
import { notify } from "$lib/notifications";
import { callWebhook } from "$lib/webhooks";
import reverse from "buffer-reverse";
import zmq from "zeromq/v5-compat";
import { Op } from "@sequelize/core";
import { fromBase58 } from "bip32";
import bitcoin from "bitcoinjs-lib";
import liquidJs from "liquidjs-lib";
import { l, err, warn } from "$lib/logging";
import lq from "$lib/liquid";
import sendLightning from "$lib/send";

const { Block, networks, Transaction } = liquidJs;

const network =
  networks[
    config.liquid.network === "mainnet" ? "liquid" : config.liquid.network
  ];

import { computeConversionFee } from "./conversionFee";

const getAccount = async (params, transaction) => {
  let account = await db.Account.findOne({
    where: params,
    lock: transaction.LOCK.UPDATE,
    transaction
  });

  if (account) {
    l("found account", params, account.asset, account.id);
    return account;
  }

  let { asset, pubkey } = params;
  let name = asset.substr(0, 6);
  let domain = "";
  let ticker = asset.substr(0, 3).toUpperCase();
  let precision = 8;

  if (pubkey) {
    const nc = await db.Account.findOne({
      where: { pubkey },
      order: [["id", "ASC"]],
      limit: 1,
      lock: transaction.LOCK.UPDATE,
      transaction
    });

    params.index = 0;
    params.path = nc.path;
    params.pubkey = nc.pubkey;
    params.privkey = nc.privkey;
    params.seed = nc.seed;
  }

  if (store.assets[asset]) {
    ({ domain, ticker, precision, name } = store.assets[asset]);
  } else {
    const existing = await db.Account.findOne({
      where: {
        asset
      },
      order: [["id", "ASC"]],
      limit: 1,
      lock: transaction.LOCK.UPDATE,
      transaction
    });

    if (existing) {
      l("existing", existing.id);
      ({ domain, ticker, precision, name } = existing);
    }
  }

  params = { ...params, ...{ domain, ticker, precision, name } };
  params.balance = 0;
  params.pending = 0;
  params.network = "liquid";
  return db.Account.create(params, { transaction });
};

const zmqRawBlock = zmq.socket("sub");
zmqRawBlock.connect(config.liquid.zmqrawblock);
zmqRawBlock.subscribe("rawblock");

const zmqRawTx = zmq.socket("sub");
zmqRawTx.connect(config.liquid.zmqrawtx);
zmqRawTx.subscribe("rawtx");

const queue = {};
const seen = [];

zmqRawTx.on("message", async (topic, message, sequence) => {
  try {
    const hex = message.toString("hex");

    let unblinded, tx, blinded, txid;
    try {
      txid = Transaction.fromHex(hex).getId();
      if (seen.includes(txid)) return;
      seen.push(txid);
      if (seen.length > 5000) seen.shift();

      unblinded = await lq.unblindRawTransaction(hex);
      tx = await lq.decodeRawTransaction(unblinded.hex);
      blinded = await lq.decodeRawTransaction(hex);
    } catch (e) {
      return err("problem decoding liquid tx", e.message);
    }

    for (let o of tx.vout) {
      try {
        if (!(o.scriptPubKey && o.scriptPubKey.address)) return;

        const { asset } = o;
        const value = toSats(o.value);
        const { address } = o.scriptPubKey;

        if (
          Object.keys(store.addresses).includes(address) &&
          !store.change.includes(address)
        ) {
          await db.transaction(async transaction => {
            let user = await getUser(store.addresses[address], transaction);

            let invoice = await db.Invoice.findOne({
              where: {
                [Op.or]: {
                  unconfidential: address,
                  address
                },
                user_id: user.id,
                network: "liquid"
              },
              order: [["id", "DESC"]],
              transaction
            });

            if (!invoice) return;

            let confirmed = 0;

            let account = await db.Account.findOne({
              where: {
                id: invoice.account_id,
                asset
              },
              lock: transaction.LOCK.UPDATE,
              transaction
            });

            if (!account) {
              let pubkey = account ? account.pubkey : null;

              account = await getAccount(
                {
                  user_id: user.id,
                  asset,
                  pubkey
                },
                transaction
              );
            }

            await account.increment({ pending: value }, { transaction });
            await account.reload({ transaction });

            if (config.liquid.walletpass)
              await lq.walletPassphrase(config.liquid.walletpass, 300);

            await user.save({ transaction });

            const currency = invoice ? invoice.currency : user.currency;
            const rate = invoice ? invoice.rate : store.rates[user.currency];
            const tip = invoice ? invoice.tip : 0;
            const memo = invoice ? invoice.memo : "";

            let payment = await db.Payment.create(
              {
                account_id: account.id,
                user_id: user.id,
                hash: blinded.txid,
                amount: value - tip,
                currency,
                memo,
                rate,
                received: true,
                tip,
                confirmed,
                address,
                network: "liquid",
                invoice_id: invoice.id
              },
              { transaction }
            );

            payment = payment.get({ plain: true });
            payment.account = account.get({ plain: true });
            payment.invoice = invoice.get({ plain: true });

            emit(user.username, "payment", payment);
            emit(user.username, "account", payment.account);
            l("liquid detected", address, user.username, asset, value);
            notify(user, `${value} SAT payment detected`);
            callWebhook(invoice, payment);
          });
        }
      } catch (e) {
        console.log(e);
        err("Problem processing transaction", e.message, e.stack);
      }
    }
  } catch (e) {
    console.log(e);
  }
});

zmqRawBlock.on("message", async (topic, message, sequence) => {
  try {
    const payments = await db.Payment.findAll({
      where: { confirmed: 0 }
    });

    let hash, json;

    hash = await lq.getBlockHash(getBlockHeight(message));
    json = await lq.getBlock(hash, 2);

    for (let tx of json.tx) {
      if (store.issuances[tx.txid]) {
        await db.transaction(async transaction => {
          const {
            user_id,
            asset,
            asset_amount,
            asset_payment_id,
            token,
            token_amount,
            token_payment_id
          } = store.issuances[tx.txid];

          const user = await getUserById(user_id);

          let account = await db.Account.findOne({
            where: { user_id, asset },
            lock: transaction.LOCK.UPDATE,
            transaction
          });
          account.balance = Math.round(asset_amount * SATS);
          account.pending = 0;
          await account.save({ transaction });

          let payment = await db.Payment.findOne({
            where: { id: asset_payment_id },
            include: {
              model: db.Account,
              as: "account"
            },
            lock: transaction.LOCK.UPDATE,
            transaction
          });

          payment.confirmed = true;
          await payment.save({ transaction });
          payment = payment.get({ plain: true });
          payment.account = account.get({ plain: true });

          emit(user.username, "account", account);
          emit(user.username, "payment", payment);

          if (token) {
            account = await db.Account.findOne({
              where: { user_id, asset: token },
              lock: transaction.LOCK.UPDATE,
              transaction
            });
            account.balance = token_amount * SATS;
            account.pending = 0;
            await account.save({ transaction });

            payment = await db.Payment.findOne({
              where: { id: token_payment_id },
              include: {
                model: db.Account,
                as: "account"
              },
              lock: transaction.LOCK.UPDATE,
              transaction
            });

            payment.confirmed = true;
            await payment.save({ transaction });

            payment = payment.get({ plain: true });
            payment.account = account.get({ plain: true });

            emit(user.username, "account", account);
            emit(user.username, "payment", payment);
          }
        });
      } else if (payments.find(p => p.hash === tx.txid)) queue[tx.txid] = 1;
    }
  } catch (e) {
    return console.log(e);
  }
});

setInterval(async () => {
  try {
    const arr = Object.keys(queue);

    for (let i = 0; i < arr.length; i++) {
      const hash = arr[i];

      let account, invoice, address, user, total, p, conversions;
      await db.transaction(async transaction => {
        p = await db.Payment.findOne({
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

        if (p && p.address) address = p.address;
        if (p && p.user) user = p.user;

        if (p && p.account) {
          ({ account, invoice } = p);
          conversions = await invoice.getConversions();
          total = p.amount + p.tip;
          p.confirmed = 1;
          await account.save({ transaction });

          await invoice.increment({ received: total }, { transaction });
          await account.increment({ balance: total }, { transaction });
          await account.decrement(
            { pending: Math.min(account.pending, total) },
            { transaction }
          );
          await account.increment(
            { liquid_credits: computeConversionFee(total) },
            { transaction }
          );
          await account.reload({ transaction });
          await invoice.reload({ transaction });

          await p.save({ transaction });

          p = p.get({ plain: true });
          account = account.get({ plain: true });
          invoice = invoice.get({ plain: true });

          emit(user.username, "account", account);
          emit(user.username, "payment", p);

          l("liquid confirmed", user.username, account.asset, p.amount, p.tip);

          notify(user, `${total} SAT payment confirmed`);
          callWebhook(p.invoice, p);
        } else {
          warn("couldn't find liquid payment", hash);
        }

        delete queue[hash];
      });

      user.account = p.account;

      console.log("CONVERSIONS", conversions.length)

      for (let i = 0; i < conversions.length; i++) {
        console.log("sending lightning");
        let conversion = conversions[i];
        let result = await sendLightning(p.amount, "", conversion.text, user);
        console.log("RESULT", result);
      }

      let c = store.convert[address];
      if (address && c && p.account.asset === network.assetHash) {
        l(
          "liquid detected for conversion request",
          address,
          c.address,
          user.username
        );

        sendLiquid({
          address: c.address,
          amount: total - 100,
          user,
          limit: total
        });
      }
    }
  } catch (e) {
    err("problem processing queued liquid transaction", e.message, e.stack);
  }
}, 1000);
