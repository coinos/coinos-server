const reverse = require("buffer-reverse");
const zmq = require("zeromq/v5-compat");
const { Op } = require("sequelize");
const { fromBase58 } = require("bip32");
const bitcoin = require("bitcoinjs-lib");
const { Block, networks, Transaction } = require("liquidjs-lib");
const wretch = require("wretch");
const fetch = require("node-fetch");
wretch().polyfills({ fetch });

const network =
  networks[
    config.liquid.network === "mainnet" ? "liquid" : config.liquid.network
  ];

const { computeConversionFee } = require('./conversionFee.js');

const getAccount = async (params, transaction) => {
  let account = await db.Account.findOne({
    where: params,
    lock: transaction.LOCK.UPDATE,
    transaction
  });

  if (account) {
    l.info("found account", params, account.asset, account.id);
    return account;
  }

  let { asset } = params;
  let name = asset.substr(0, 6);
  let domain = "";
  let ticker = asset.substr(0, 3).toUpperCase();
  let precision = 8;

  const assets = app.get("assets");

  if (assets[asset]) {
    ({ domain, ticker, precision, name } = assets[asset]);
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
      l.info("existing", existing.id);
      ({ domain, ticker, precision, name } = existing);
    }
  }

  params = { ...params, ...{ domain, ticker, precision, name } };
  params.balance = 0;
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
    return l.error("problem decoding liquid tx", e.message);
  }

  Promise.all(
    tx.vout.map(async o => {
      try {
        if (!(o.scriptPubKey && o.scriptPubKey.addresses)) return;

        const { asset } = o;
        const value = toSats(o.value);
        const address = o.scriptPubKey.addresses[0];

        if (
          Object.keys(addresses).includes(address) &&
          !change.includes(address)
        ) {
          await db.transaction(async transaction => {
            let user = await getUser(addresses[address], transaction);

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

            let payment = await db.Payment.findOne({
              where: {
                invoice_id: invoice.id,
              },
              order: [["id", "DESC"]],
              transaction
            });

            if (payment) return;

            let confirmed = 0;

            let account = await db.Account.findOne({
              where: {
                id: invoice.account_id,
                asset
              },
              lock: transaction.LOCK.UPDATE,
              transaction
            });

            if (
              account.asset === asset &&
              (!account.pubkey || account.network === "liquid")
            ) {
              await account.increment({ pending: value }, { transaction });
              await account.reload({ transaction });
            } else {
              account = await getAccount(
                {
                  seed: account.seed,
                  path: account.path,
                  user_id: user.id,
                  asset,
                  pubkey: account.pubkey,
                  //pending: value,
                  index: 0
                },
                transaction
              );
            }

            if (config.liquid.walletpass)
              await lq.walletPassphrase(config.liquid.walletpass, 300);

            await user.save({ transaction });

            const currency = invoice ? invoice.currency : user.currency;
            const rate = invoice
              ? invoice.rate
              : app.get("rates")[user.currency];
            const tip = invoice ? invoice.tip : 0;
            const memo = invoice ? invoice.memo : "";

            payment = await db.Payment.create(
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

            emit(user.username, "payment", payment);
            emit(user.username, "account", payment.account);
            l.info("liquid detected", address, user.username, asset, value);
            notify(user, `${value} SAT payment detected`);
            callWebhook(invoice, payment);
          });
        }
      } catch (e) {
        l.error("Problem processing transaction", e.message, e.stack);
      }
    })
  );
});

zmqRawBlock.on("message", async (topic, message, sequence) => {
  try {
    const payments = await db.Payment.findAll({
      where: { confirmed: 0 }
    });

    const block = Block.fromHex(message.toString("hex"), true);

    let hash, json;

    hash = await lq.getBlockHash(block.blockHeight);
    json = await lq.getBlock(hash, 2);

    json.tx.map(async tx => {
      if (issuances[tx.txid]) {
        await db.transaction(async transaction => {
          const {
            user_id,
            asset,
            asset_amount,
            asset_payment_id,
            token,
            token_amount,
            token_payment_id
          } = issuances[tx.txid];

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
    });
  } catch (e) {
    return console.log(e);
  }
});

setInterval(async () => {
  try {
    const arr = Object.keys(queue);

    for (let i = 0; i < arr.length; i++) {
      const hash = arr[i];

      let account, address, user, total, p;
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
          total = p.amount + p.tip;
          p.confirmed = 1;
          await p.account.save({ transaction });

          await p.account.increment({ balance: total }, { transaction });
          await p.account.decrement(
            { pending: Math.min(p.account.pending, total) },
            { transaction }
          );
          await p.account.increment({ liquid_credits: computeConversionFee(total) }, { transaction });
          await p.account.reload({ transaction });

          await p.save({ transaction });

          p = p.get({ plain: true });

          emit(user.username, "account", p.account);
          emit(user.username, "payment", p);

          l.info(
            "liquid confirmed",
            user.username,
            p.account.asset,
            p.amount,
            p.tip
          );

          notify(user, `${total} SAT payment confirmed`);
          callWebhook(p.invoice, p);
        } else {
          l.warn("couldn't find liquid payment", hash);
        }

        delete queue[hash];
      });

      let c = convert[address];
      if (address && c && p.account.asset === network.assetHash) {
        l.info(
          "liquid detected for conversion request",
          address,
          c.address,
          user.username
        );

        user.account = p.account;

        sendLiquid({
          address: c.address,
          amount: total - 100,
          user,
          limit: total
        });
      }
    }
  } catch (e) {
    l.error("problem processing queued liquid transaction", e.message, e.stack);
  }
}, 1000);
