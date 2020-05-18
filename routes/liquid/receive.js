const axios = require("axios");
const reverse = require("buffer-reverse");
const zmq = require("zeromq");
const { Op } = require("sequelize");
const elements = require("elementsjs-lib");

const zmqRawBlock = zmq.socket("sub");
zmqRawBlock.connect(config.liquid.zmqrawblock);
zmqRawBlock.subscribe("rawblock");

const zmqRawTx = zmq.socket("sub");
zmqRawTx.connect("tcp://127.0.0.1:18603");
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

      if (Object.keys(addresses).includes(address)) {
        let user = await db.User.findOne({
          where: {
            username: addresses[address],
          },
        });

        let confirmed = 0;

        let params = {
          user_id: user.id,
          asset,
        };

        let account = await db.Account.findOne({
          where: params,
        });

        if (account) {
          account.pending += value;
          await account.save();
        } else {
          let name = asset.substr(0, 6);
          let ticker = asset.substr(0, 3).toUpperCase();
          let precision = 8;

          const assets = (await axios.get("https://assets.blockstream.info/"))
            .data;

          if (assets[asset]) {
            ({ ticker, precision, name } = assets[asset]);
          }

          params = { ...params, ...{ ticker, precision, name } };
          params.balance = 0;
          params.pending = value;
          account = await db.Account.create(params);
        }

        if (config.liquid.walletpass)
          await lq.walletPassphrase(config.liquid.walletpass, 300);

        user.confidential = await lq.getNewAddress();
        user.liquid = (
          await lq.getAddressInfo(user.confidential)
        ).unconfidential;

        await user.save();

        addresses[user.liquid] = user.username;

        let invoice;
        if (asset === config.liquid.btcasset) {
          invoice = await db.Invoice.findOne({
            where: {
              user_id: user.id,
              network: "LBTC",
            },
            order: [["id", "DESC"]],
          });
        }

        const currency = invoice ? invoice.currency : user.currency;
        const rate = invoice ? invoice.rate : app.get("rates")[user.currency];
        const tip = invoice ? invoice.tip : null;

        let payment = await db.Payment.create({
          account_id: account.id,
          user_id: user.id,
          hash: blinded.txid,
          amount: value - tip,
          currency,
          rate,
          received: true,
          tip,
          confirmed,
          address,
          network: "LBTC",
        });

        payments.push(blinded.txid);
        payment = payment.get({ plain: true });
        payment.account = account.get({ plain: true });

        user = await getUser(user.username);
        emit(user.username, "payment", payment);
        emit(user.username, "user", user);
        l.info("liquid detected", user.username, asset, value);
      }
    })
  );
});

let queue = {};

zmqRawBlock.on("message", async (topic, message, sequence) => {
  const payments = await db.Payment.findAll({
    where: { confirmed: 0 },
  });

  const hashes = payments.map((p) => p.hash);

  const block = elements.Block.fromHex(message.toString("hex"), true);
  const hash = await lq.getBlockHash(block.height);
  const json = await lq.getBlock(hash, 2);

  json.tx.map((tx) => {
    if (hashes.includes(tx.txid)) queue[tx.txid] = 1;
  });
});

setInterval(async () => {
  try {
    let arr = Object.keys(queue);

    for (let i = 0; i < arr.length; i++) {
      let hash = arr[i];

      let p = await db.Payment.findOne({
        where: { hash, confirmed: 0, received: 1 },
        include: {
          model: db.Account,
          as: "account",
        },
      });

      p.confirmed = 1;
      p.account.balance += p.amount + p.tip;
      p.account.pending -= Math.min(p.account.pending, p.amount + p.tip);

      await p.account.save();
      await p.save();

      let user = await getUserById(p.user_id);
      emit(user.username, "user", user);
      emit(user.username, "payment", p);
      l.info(
        "liquid confirmed",
        user.username,
        p.account.asset,
        p.amount,
        p.tip
      );

      delete queue[hash];
    }
  } catch (e) {
    l.error("problem processing queued liquid transaction", e.message);
  }
}, 1000);
