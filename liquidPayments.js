const reverse = require("buffer-reverse");
const zmq = require("zeromq");
const config = require("./config");
const Sequelize = require("sequelize");
const BitcoinCore = require("bitcoin-core");
const bitcoin = require("elementsjs-lib");
const l = console.log;

const zmqRawBlock = zmq.socket("sub");
zmqRawBlock.connect(config.liquid.zmqrawblock);
zmqRawBlock.subscribe("rawblock");

const zmqRawTx = zmq.socket("sub");
zmqRawTx.connect("tcp://127.0.0.1:18603");
zmqRawTx.subscribe("rawtx");

let NETWORK = bitcoin.networks[config.bitcoin.network === "mainnet" ? "bitcoin" : config.bitcoin.network];
const bc = new BitcoinCore(config.liquid);

const SATS = 100000000;

module.exports = (app, db, addresses, payments, emit) => {
  zmqRawTx.on("message", async (topic, message, sequence) => {
    const hex = message.toString("hex");
    const unblinded = await bc.unblindRawTransaction(hex);
    const tx = await bc.decodeRawTransaction(unblinded.hex);
    const blinded = await bc.decodeRawTransaction(hex);
    if (payments.includes(blinded.txid)) return;

    Promise.all(
      tx.vout.map(async o => {
        if (!(o.scriptPubKey && o.scriptPubKey.addresses)) return;
        let { value } = o;
        value *= SATS
        const address = o.scriptPubKey.addresses[0];

        if (Object.keys(addresses).includes(address)) {
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
            order: [["id", "DESC"]]
          });

          let tip = null;
          if (invoices.length) tip = invoices[0].tip;

          let confirmed = 0;

          if (user.friend) {
            user.balance += value;
            confirmed = 1;
          } else {
            user.pending += value;
          }

          user.confidential = await bc.getNewAddress();
          user.liquid = (await bc.getAddressInfo(user.confidential)).unconfidential;
          addresses[user.liquid] = user.username;

          await user.save();
          emit(user.username, "user", user);

          const payment = await db.Payment.create({
            user_id: user.id,
            hash: blinded.txid,
            amount: value,
            currency: "CAD",
            rate: app.get("ask"),
            received: true,
            tip,
            confirmed,
            address
          });
          payments.push(blinded.txid);

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
    const hash = await bc.getBlockHash(block.height);
    const json = await bc.getBlock(hash, 2);

    json.tx.map(tx => {
      if (hashes.includes(tx.txid)) queue[tx.txid] = 1;
    });
  });

  setInterval(async () => {
    let arr = Object.keys(queue);

    for (let i = 0; i < arr.length; i++) {
      let hash = arr[i];

      let p = await db.Payment.findOne({
        include: [{ model: db.User, as: "user" }],
        where: { hash, confirmed: 0, received: 1 }
      })

      p.confirmed = 1;

      let user = await p.getUser();
      user.balance += p.amount;
      user.pending -= p.amount;
      emit(user.username, "user", user);

      await user.save();
      await p.save();

      let payments = await db.Payment.findAll({
        where: { user_id: user.id },
        order: [['id', 'DESC']],
        limit: 12
      });

      emit(user.username, "payments", payments);
      delete queue[hash];
    }
  }, 1000);
};
