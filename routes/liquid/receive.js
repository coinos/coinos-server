const reverse = require("buffer-reverse");
const zmq = require("zeromq");
const { Op } = require("sequelize");
const bitcoin = require("elementsjs-lib");

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
    tx.vout.map(async o => {
      if (!(o.scriptPubKey && o.scriptPubKey.addresses)) return;

      const { asset } = o;
      const value = toSats(o.value);
      const address = o.scriptPubKey.addresses[0];

      if (Object.keys(addresses).includes(address)) {
        let user = await db.User.findOne({
          where: {
            username: addresses[address]
          }
        });

        const invoice = await db.Invoice.findOne({
          where: {
            user_id: user.id,
            asset
          },
          order: [["id", "DESC"]]
        });

        const currency = invoice ? invoice.currency : user.currency;
        const rate = invoice ? invoice.rate : app.get("rates")[user.currency];
        const tip = invoice ? invoice.tip : null;

        let confirmed = 0;

        if (asset === config.liquid.btcasset) {
          user.pending += value;
        } else {
          const params = {
            user_id: user.id,
            asset,
          };

          const account = await db.Account.findOne({
            where: params
          });

          if (account) {
            account.pending += value;
            await account.save();
          } else {
            params.balance = 0;
            params.pending = value;
            l.info("creating", params);
            await db.Account.create(params);
          }
        }

        user.confidential = await lq.getNewAddress();
        user.liquid = (await lq.getAddressInfo(
          user.confidential
        )).unconfidential;

        await user.save();
        emit(user.username, "user", user);

        addresses[user.liquid] = user.username;

        const payment = await db.Payment.create({
          user_id: user.id,
          hash: blinded.txid,
          amount: value - tip,
          currency,
          rate,
          received: true,
          tip,
          confirmed,
          address,
          asset
        });
        payments.push(blinded.txid);

        l.info("liquid detected", user.username, asset, value);
        emit(user.username, "payment", payment);
      }
    })
  );
});

let queue = {};

zmqRawBlock.on("message", async (topic, message, sequence) => {
  const payments = await db.Payment.findAll({
    where: { confirmed: 0 }
  });

  const hashes = payments.map(p => p.hash);

  const block = bitcoin.Block.fromHex(message.toString("hex"), true);
  const hash = await lq.getBlockHash(block.height);
  const json = await lq.getBlock(hash, 2);

  json.tx.map(tx => {
    if (hashes.includes(tx.txid)) queue[tx.txid] = 1;
  });
});

setInterval(async () => {
  let arr = Object.keys(queue);

  for (let i = 0; i < arr.length; i++) {
    let hash = arr[i];

    let p = await db.Payment.findOne({
      where: { hash, confirmed: 0, received: 1 }
    });

    const user = await db.User.findOne({
      include: [
        {
          model: db.Payment,
          as: "payments",
          order: [["id", "DESC"]],
          where: {
            [Op.or]: {
              received: true,
              amount: {
                [Op.lt]: 0,
              },
            },
          },
          limit: 12
        },
        {
          model: db.Account,
          as: "accounts",
        },
      ],
      where: {
        id: p.user_id
      }
    });

    p.confirmed = 1;

    const asset = await db.Account.findOne({
      where: {
        user_id: user.id,
        asset: p.asset
      }
    });

    if (p.asset === config.liquid.btcasset) {
      user.balance += p.amount + p.tip;
      user.pending -= Math.min(user.pending, p.amount + p.tip);
    } else {
      asset.balance += p.amount + p.tip;
      asset.pending -= Math.min(user.pending, p.amount + p.tip);
      await asset.save();
    }

    l.info("liquid confirmed", user.username, p.asset, p.amount, p.tip);
    emit(user.username, "user", user);

    await user.save();
    await p.save();

    let payments = await db.Payment.findAll({
      where: {
        user_id: user.id,
        received: {
          [Op.ne]: null
        }
      },
      order: [["id", "DESC"]],
      limit: 12
    });

    emit(user.username, "payments", payments);
    delete queue[hash];
  }
}, 1000);
