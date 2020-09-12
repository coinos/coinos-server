const reverse = require("buffer-reverse");
const zmq = require("zeromq");
const { Op } = require("sequelize");
const { fromBase58 } = require("bip32");

const bitcoin = require("bitcoinjs-lib");

const zmqRawBlock = zmq.socket("sub");
zmqRawBlock.connect(config.bitcoin.zmqrawblock);
zmqRawBlock.subscribe("rawblock");

const zmqRawTx = zmq.socket("sub");
zmqRawTx.connect(config.bitcoin.zmqrawtx);
zmqRawTx.subscribe("rawtx");

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

      if (
        Object.keys(addresses).includes(address) &&
        !change.includes(address)
      ) {
        payments.push(hash);

        let user = await db.User.findOne({
          where: {
            username: addresses[address]
          }
        });

        const invoice = await db.Invoice.findOne({
          where: {
            user_id: user.id,
            network: "bitcoin"
          },
          order: [["id", "DESC"]],
          include: {
            model: db.Account,
            as: "account",
          },
        });

        if (!invoice) return;

        const currency = invoice ? invoice.currency : user.currency;
        const rate = invoice ? invoice.rate : app.get("rates")[user.currency];
        const tip = invoice ? invoice.tip : 0;
        const memo = invoice ? invoice.memo : "";

        let confirmed = false;

        let { account } = invoice;

        account.pending += value;
        await account.save();

        if (config.bitcoin.walletpass)
          await bc.walletPassphrase(config.bitcoin.walletpass, 300);

        user.address = await bc.getNewAddress("", "bech32");
        await user.save();

        addresses[user.address] = user.username;

        let totalOutputs = tx.outs.reduce((a, b) => a + b.value, 0);
        let totalInputs = 0;
        for (let i = 0; i < tx.ins.length; i++) {
          let { hash, index } = tx.ins[i];
          hash = reverse(hash).toString("hex");
          let hex = await bc.getRawTransaction(hash.toString("hex"));
          let inputTx = bitcoin.Transaction.fromHex(hex);
          totalInputs += inputTx.outs[index].value;
        }
        let fee = totalInputs - totalOutputs;

        let payment = await db.Payment.create({
          account_id: account.id,
          user_id: user.id,
          hash,
          fee,
          memo,
          amount: value - tip,
          currency,
          rate,
          received: true,
          tip,
          confirmed,
          address,
          network: "bitcoin"
        });
        payment = payment.get({ plain: true });
        payment.account = account.get({ plain: true });

        emit(user.username, "account", account);

        emit(user.username, "payment", payment);
        l.info("bitcoin detected", user.username, value);
        notify(user, `${value} SAT payment detected`);
      }
    })
  );
});

let queue = {};

zmqRawBlock.on("message", async (topic, message, sequence) => {
  const payments = await db.Payment.findAll({
    where: { confirmed: false }
  });

  let block = bitcoin.Block.fromHex(message.toString("hex"));
  block.transactions.map(tx => {
    let hash = reverse(tx.getHash()).toString("hex");
    if (payments.find(p => p.hash === hash)) queue[hash] = 1;
  });
});

setInterval(async () => {
  try {
    const arr = Object.keys(queue);
    for (let i = 0; i < arr.length; i++) {
      const hash = arr[i];

      await db.transaction(async transaction => {
        let p = await db.Payment.findOne({
          where: { hash, confirmed: 0, received: 1 },
          include: [
            {
              model: db.Account,
              as: "account"
            },
            {
              model: db.User,
              as: "user"
            }
          ],
          lock: transaction.LOCK.UPDATE,
          transaction
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
          l.info("bitcoin confirmed", user.username, p.amount, p.tip);
          notify(user, `${total} SAT payment confirmed`);
        } else {
          l.warn("couldn't find payment", hash);
        }

        delete queue[hash];
      });
    }
  } catch (e) {
    l.error("problem processing queued bitcoin transaction", e.message);
  }
}, 1000);
