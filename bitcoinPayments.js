const reverse = require("buffer-reverse");
const zmq = require("zeromq");
const config = require("./config");
const Sequelize = require("sequelize");

const bitcoin = require("bitcoinjs-lib");
const l = require("pino")();

const zmqRawBlock = zmq.socket("sub");
zmqRawBlock.connect(config.bitcoin.zmqrawblock);
zmqRawBlock.subscribe("rawblock");

const zmqRawTx = zmq.socket("sub");
zmqRawTx.connect(config.bitcoin.zmqrawtx);
zmqRawTx.subscribe("rawtx");

let NETWORK = bitcoin.networks[config.bitcoin.network === "mainnet" ? "bitcoin" : config.bitcoin.network];

module.exports = (app, bc, db, addresses, payments, emit) => {
  zmqRawTx.on("message", (topic, message, sequence) => {
    message = message.toString("hex");

    let tx = bitcoin.Transaction.fromHex(message);
    let hash = reverse(tx.getHash()).toString("hex");

    if (payments.includes(hash)) return;

    Promise.all(
      tx.outs.map(async o => {

        let address;
        try {
          address = bitcoin.address.fromOutputScript(
            o.script,
            NETWORK
          );
        } catch (e) {
          return;
        }

        if (Object.keys(addresses).includes(address)) {
          payments.push(hash);

          let user = await db.User.findOne({
            where: {
              username: addresses[address]
            }
          });

          let invoices = await db.Payment.findAll({
            limit: 1,
            where: {
              address,
              received: null,
              amount: {
                [Sequelize.Op.gt]: 0
              }
            },
            order: [["createdAt", "DESC"]]
          });

          let tip = null;
          if (invoices.length) tip = invoices[0].tip;

          let confirmed = false;

          if (user.friend) {
            user.balance += o.value;
            confirmed = true;
          } else {
            user.pending += o.value;
          }

          user.address = await bc.getNewAddress("", "bech32");
          addresses[user.address] = user.username;
          await user.save();
          emit(user.username, "user", user);

          const payment = await db.Payment.create({
            user_id: user.id,
            hash,
            amount: o.value,
            currency: user.currency,
            rate: app.get("rates")[user.currency],
            received: true,
            tip,
            confirmed,
            address,
            asset: 'BTC',
          });

          emit(user.username, "payment", payment);
        }
      })
    );
  });

  let queue = {};

  zmqRawBlock.on("message", async (topic, message, sequence) => {
    const payments = await db.Payment.findAll({
      where: { confirmed: false }
    });

    const hashes = payments.map(p => p.hash);

    let block = bitcoin.Block.fromHex(message.toString("hex"));
    block.transactions.map(tx => {
      let hash = reverse(tx.getHash()).toString("hex");
      if (hashes.includes(hash)) queue[hash] = 1;
    }); 
  });

  setInterval(async () => {
    let arr = Object.keys(queue);
    for (let i = 0; i < arr.length; i++) {
      let hash = arr[i];

      let p = await db.Payment.findOne({
        include: [{ model: db.User, as: "user" }],
        where: { hash, confirmed: 0 }
      })

      p.confirmed = 1;

      let user = await p.getUser();
      user.balance += p.amount;
      user.pending -= p.amount;
      emit(user.username, "user", user);

      await user.save();
      await p.save();

      let payments = await db.Payment.findAll({
        where: { 
          user_id: user.id,
          received: { 
            [Sequelize.Op.ne]: null
          },
        },
        order: [['id', 'DESC']],
        limit: 12
      });

      emit(user.username, "payments", payments);
      delete queue[hash];
    }
  }, 1000);
};
