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

module.exports = (app, bc, db, addresses, payments, emit) => {
  zmqRawTx.on("message", (topic, message, sequence) => {
    message = message.toString("hex");

    let tx = bitcoin.Transaction.fromHex(message);
    let hash = reverse(tx.getHash()).toString("hex");

    if (payments.includes(hash)) return;

    Promise.all(
      tx.outs.map(async o => {
        let network = config.bitcoin.network;
        if (network === "mainnet") {
          network = "bitcoin";
        }

        let address;
        try {
          address = bitcoin.address.fromOutputScript(
            o.script,
            bitcoin.networks[network]
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
              hash: address,
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
            confirmed
          });

          l("tx", message);
          emit(user.username, "tx", message);
        }
      })
    );
  });

  zmqRawBlock.on("message", async (topic, message, sequence) => {
    topic = topic.toString("utf8");
    message = message.toString("hex");

    switch (topic) {
      case "rawblock": {
        let block = bitcoin.Block.fromHex(message);
        l("block", block.getHash().toString("hex"));

        const processPayment = async (payment, transaction) => {
          if (
            (await bc.getRawTransaction(payment.hash, true)).confirmations > 0
          ) {
            let user = await db.User.findByPk(payment.user_id, { transaction });
            payment.confirmed = true;
            user.balance += payment.amount;
            user.pending -= payment.amount;
            await user.save({ transaction });
            await payment.save({ transaction });
            emit(user.username, "user", user);
            emit(user.username, "block", message);
          }
        };

        const transaction = await db.transaction();
        try {
          const payments = await db.Payment.findAll({
            where: { confirmed: false },
            lock: transaction.LOCK.UPDATE,
            transaction
          });

          await Promise.all(
            payments.map(async payment => {
              await processPayment(payment, transaction);
              return;
            })
          );
        } catch (e) {
          transaction.rollback();
        }

        await transaction.commit();

        break;
      }
    }
  });
};
