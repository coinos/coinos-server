const axios = require("axios");
const reverse = require("buffer-reverse");
const zmq = require("zeromq");
const { Op } = require("sequelize");
const { fromBase58 } = require("bip32");
const bitcoin = require("bitcoinjs-lib");
const elements = require("elementsjs-lib");
const liquid = require("liquidjs-lib");

const network =
  liquid.networks[
    config.liquid.network === "mainnet" ? "liquid" : config.liquid.network
  ];

const getAccount = async (params) => {
  let account = await db.Account.findOne({
    where: params
  });


  if (account) {
    l.info("found account", params, account.asset, account.id);
    return account;
  } 

  let { asset, pubkey } = params;
  let name = asset.substr(0, 6);
  let domain = "";
  let ticker = asset.substr(0, 3).toUpperCase();
  let precision = 8;

  const assets = app.get('assets');

  if (assets[asset]) {
    ({ domain, ticker, precision, name } = assets[asset]);
  } else {
    const existing = await db.Account.findOne({
      where: {
        asset,
        pubkey,
      },
      order: [["id", "ASC"]],
      limit: 1,
    });

    if (existing) {
      l.info("existing", existing.id);
      ({ domain, ticker, precision, name } = existing);
    }
  }

  params = { ...params, ...{ domain, ticker, precision, name } };
  params.balance = 0;
  params.network = 'liquid';
  return db.Account.create(params);
};

const zmqRawBlock = zmq.socket("sub");
zmqRawBlock.connect(config.liquid.zmqrawblock);
zmqRawBlock.subscribe("rawblock");

const zmqRawTx = zmq.socket("sub");
zmqRawTx.connect(config.liquid.zmqrawtx);
zmqRawTx.subscribe("rawtx");

zmqRawTx.on("message", async (topic, message, sequence) => {
  const hex = message.toString("hex");
  const unblinded = await lq.unblindRawTransaction(hex);
  const tx = await lq.decodeRawTransaction(unblinded.hex);
  const blinded = await lq.decodeRawTransaction(hex);
  if (payments.includes(blinded.txid)) return;

  Promise.all(
    tx.vout.map(async (o) => {
      if (!(o.scriptPubKey && o.scriptPubKey.addresses)) return;

      const { asset } = o;
      const value = toSats(o.value);
      const address = o.scriptPubKey.addresses[0];

      if (
        Object.keys(addresses).includes(address) &&
        !change.includes(address)
      ) {
        let user = await getUser(addresses[address]);

        let invoice = await db.Invoice.findOne({
          where: {
            unconfidential: address,
            user_id: user.id,
            network: "liquid",
          },
          order: [["id", "DESC"]],
          include: {
            model: db.Account,
            as: "account",
          },
        });

        if (!invoice) return;

        let confirmed = 0;

        let { account } = invoice;

        if (account.asset === asset && (!account.pubkey || account.network === 'liquid')) {
          account.pending += value;
          await account.save();
        } else {
          account = await getAccount(
            {
              seed: account.seed,
              path: account.path,
              user_id: user.id,
              asset,
              pubkey: account.pubkey,
              pending: value,
              index: 0,
            },
          );
        }

        if (config.liquid.walletpass)
          await lq.walletPassphrase(config.liquid.walletpass, 300);

        await user.save();

        const currency = invoice ? invoice.currency : user.currency;
        const rate = invoice ? invoice.rate : app.get("rates")[user.currency];
        const tip = invoice ? invoice.tip : 0;
        const memo = invoice ? invoice.memo : "";

        let payment = await db.Payment.create({
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
        });

        payments.push(blinded.txid);
        payment = payment.get({ plain: true });
        payment.account = account.get({ plain: true });

        emit(user.username, "payment", payment);
        emit(user.username, "account", payment.account);
        l.info("liquid detected", address, user.username, asset, value);
        notify(user, `${value} SAT payment detected`);
      }
    })
  );
});

let queue = {};

zmqRawBlock.on("message", async (topic, message, sequence) => {
  const payments = await db.Payment.findAll({
    where: { confirmed: 0 },
  });

  const block = elements.Block.fromHex(message.toString("hex"), true);
  const hash = await lq.getBlockHash(block.height);
  const json = await lq.getBlock(hash, 2);

  json.tx.map(async (tx) => {
    if (issuances[tx.txid]) {
      await db.transaction(async (transaction) => {
        const {
          user_id,
          asset,
          asset_amount,
          asset_payment_id,
          token,
          token_amount,
          token_payment_id,
        } = issuances[tx.txid];

        const user = await getUserById(user_id);

        let account = await db.Account.findOne({
          where: { user_id, asset },
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        account.balance = asset_amount * SATS;
        account.pending = 0;
        await account.save({ transaction });

        let payment = await db.Payment.findOne({
          where: { id: asset_payment_id },
          include: {
            model: db.Account,
            as: "account",
          },
          lock: transaction.LOCK.UPDATE,
          transaction,
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
            transaction,
          });
          account.balance = token_amount * SATS;
          account.pending = 0;
          await account.save({ transaction });

          payment = await db.Payment.findOne({
            where: { id: token_payment_id },
            include: {
              model: db.Account,
              as: "account",
            },
            lock: transaction.LOCK.UPDATE,
            transaction,
          });

          payment.confirmed = true;
          await payment.save({ transaction });

          payment = payment.get({ plain: true });
          payment.account = account.get({ plain: true });

          emit(user.username, "account", account);
          emit(user.username, "payment", payment);
        }
      });
    } else if (payments.find((p) => p.hash === tx.txid)) queue[tx.txid] = 1;
  });
});

setInterval(async () => {
  //  throw new Error("boom");
  try {
    const arr = Object.keys(queue);

    for (let i = 0; i < arr.length; i++) {
      const hash = arr[i];

      await db.transaction(async (transaction) => {
        let p = await db.Payment.findOne({
          where: { hash, confirmed: 0, received: 1 },
          include: [
            {
              model: db.Account,
              as: "account",
            },
            {
              model: db.User,
              as: "user",
            },
          ],
          lock: transaction.LOCK.UPDATE,
          transaction,
        });

        const { user } = p;

        if (p) {
          let total = p.amount + p.tip;
          p.confirmed = 1;
          p.account.balance += total;
          p.account.pending -= Math.min(p.account.pending, total);

          await p.account.save({ transaction });
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
        } else {
          l.warn("couldn't find payment", hash);
        }

        delete queue[hash];
      });
    }
  } catch (e) {
    l.error("problem processing queued liquid transaction", e.message);
  }
}, 1000);
