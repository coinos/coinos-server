const reverse = require("buffer-reverse");
const zmq = require("zeromq");
const config = require("./config");
const Sequelize = require("sequelize");

const bitcoin = require("bitcoinjs-lib");
const l = console.log;

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

          await user.save();
          emit(user.username, "user", user);

          await db.Payment.create({
            user_id: user.id,
            hash,
            amount: o.value,
            currency: "CAD",
            rate: app.get("ask"),
            received: true,
            tip,
            confirmed,
            address
          });

          emit(user.username, "tx", message);
        }
      })
    );
  });

  let queue = {};

  zmqRawBlock.on("message", async (topic, message, sequence) => {
    const payments = await db.Payment.findAll({
      where: { confirmed: false }
    });

    const addresses = payments.map(p => p.address);

    let block = bitcoin.Block.fromHex(message.toString("hex"));
    block.transactions.map(tx => {
      tx.outs.map(o => {
        try {
          let address = bitcoin.address.fromOutputScript(o.script, NETWORK);
          if (addresses.includes(address)) {
            queue[address] || (queue[address] = 0)
            queue[address] += o.value;
          } 
        } catch (e) {
          return;
        }
      })
    }); 
  });

  setInterval(() => {
    Object.keys(queue).map(async address => {
      l(address);

      let user = await db.User.findOne({
        where: {
          username: addresses[address],
        }
      });

      l(user.pending);

      const payments = await db.Payment.findAll({
        where: { confirmed: false, address }
      });

      await Promise.all(payments.map(async p => {
        if (p.amount <= queue[address]) {
          l(user.pending, p.amount, queue[address]);
          queue[address] -= p.amount;
          if (queue[address] <= 0) delete queue[address];
          p.confirmed = 1;
          await p.save();
          user.balance += p.amount;
          user.pending -= p.amount;
          await user.save();
          emit(user.username, "user", user);
          emit(user.username, "block", 1);
        } 
      }));
    });
  }, 1000);
};
