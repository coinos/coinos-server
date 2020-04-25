const reverse = require("buffer-reverse");
const zmq = require("zeromq");
const { Op } = require("sequelize");

const bitcoin = require("bitcoinjs-lib");

const zmqRawBlock = zmq.socket("sub");
zmqRawBlock.connect(config.bitcoin.zmqrawblock);
zmqRawBlock.subscribe("rawblock");

const zmqRawTx = zmq.socket("sub");
zmqRawTx.connect(config.bitcoin.zmqrawtx);
zmqRawTx.subscribe("rawtx");

const asset = "BTC";
const network =
  bitcoin.networks[
    config.bitcoin.network === "mainnet" ? "bitcoin" : config.bitcoin.network
  ];

zmqRawTx.on("message", async (topic, message, sequence) => {
  const hex = message.toString("hex");
  let tx = bitcoin.Transaction.fromHex(message);
  let hash = reverse(tx.getHash()).toString("hex");

  if (payments.includes(hash)) return;

  Promise.all(
    tx.outs.map(async o => {
      const { value } = o;

      let address;
      try {
        address = bitcoin.address.fromOutputScript(o.script, network);
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

        let confirmed = false;

        user.address = await bc.getNewAddress("", "bech32");
        user.pending += value;

        await user.save();
        emit(user.username, "user", user);

        addresses[user.address] = user.username;

        const payment = await db.Payment.create({
          user_id: user.id,
          hash,
          amount: value - tip,
          currency,
          rate,
          received: true,
          tip,
          confirmed,
          address,
          asset,
        });

        l.info("bitcoin detected", user.username, o.value);
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
      where: { hash, confirmed: 0 }
    });

    p.confirmed = 1;

    const user = await getUserById(p.user_id); 
    user.balance += p.amount + p.tip;
    user.pending -= Math.min(user.pending, p.amount + p.tip);
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

    l.info("bitcoin confirmed", user.username, p.amount, p.tip);
    emit(user.username, "payments", payments);
    delete queue[hash];
  }
}, 1000);
