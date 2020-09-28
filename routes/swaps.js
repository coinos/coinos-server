const axios = require("axios");
const crypto = require("crypto");
const level = require("level");
const fs = require("fs");
const { spawn } = require("child_process");
const leveldb = level("leveldb");
const getAccount = require("../lib/account");
const { Op, col } = require("sequelize");
const shallow = a => {
  let b = {};
  for (x in a) {
    if (a[x] instanceof Date || typeof a[x] !== "object") b[x] = a[x];
  }
  return b;
};

const assets = {
  b2e15d0d7a0c94e4e2ce0fe6e8691b9e451377f6e46e8045a86f7c4b5d4f0f23: "bitcoin",
  "4eebe36eb0819e6daa5dd3c97733251ff4eb728c810d949365d6dacaad5ef6e8": "tether"
};

const swapsdir = "swaps/";
if (!fs.existsSync(swapsdir)) {
  fs.mkdirSync(swapsdir);
}

const timeout = 20000;

const cli = (...args) => {
  const params = ["--regtest", "-c", config.liquid.conf, ...args];
  if (config.liquid.network !== "regtest") params.shift();
  l.info("spawning liquidswap-cli with params:", params);
  return spawn("liquidswap-cli", params);
};

const getInfo = filename =>
  new Promise((resolve, reject) => {
    const proc = cli("info", swapsdir + filename);

    proc.stdout.on("data", data => {
      resolve(data.toString());
    });

    proc.stderr.on("data", err => {
      l.error("info error", err.toString());
      reject(err.toString());
    });

    proc.on("close", (code, signal) => {
      let msg = (code && code.toString()) || (signal && signal.toString());
      reject(new Error(`Liquid swap tool process closed unexpectedly: ${msg}`));
    });

    proc.on("exit", (code, signal) => {
      let msg = (code && code.toString()) || (signal && signal.toString());
      reject(new Error(`Liquid swap tool process exited unexpectedly: ${msg}`));
    });

    setTimeout(
      () => reject(new Error("Liquid swap tool timed out"), proc),
      timeout
    );
  });

app.delete(
  "/proposal/:id",
  auth,
  ah(async (req, res) => {
    const { id } = req.params;
    const { user } = req;

    await db.transaction(async transaction => {
      let proposal = await db.Proposal.findOne(
        {
          where: {
            id,
            user_id: user.id
          },
          include: {
            model: db.Account,
            as: "acc1"
          }
        },

        { transaction }
      );

      let { acc1: account, v1, v2 } = proposal;
      await account.increment({ balance: v1 }, { transaction });
      await account.reload({ transaction });

      let rate = v2 / v1;
      let payment = await db.Payment.create(
        {
          hash: "Trade Cancelled",
          amount: v1,
          account_id: account.id,
          user_id: user.id,
          currency: user.currency,
          rate: app.get("rates")[user.currency],
          confirmed: true,
          received: true,
          network: "COINOS"
        },
        { transaction }
      );

      emit(user.username, "account", account.get({ plain: true }));
      emit(user.username, "payment", payment.get({ plain: true }));

      if (proposal.fee) {
        const btc = await getAccount(config.liquid.btcasset, user, transaction);

        payment = await db.Payment.create(
          {
            hash: "Swap Fee Refund",
            amount: proposal.fee,
            account_id: btc.id,
            user_id: user.id,
            currency: user.currency,
            rate: app.get("rates")[user.currency],
            confirmed: true,
            received: true,
            network: "COINOS"
          },
          { transaction }
        );

        await btc.increment({ balance: proposal.fee }, { transaction });
        await btc.reload({ transaction });

        emit(user.username, "account", btc.get({ plain: true }));
        emit(user.username, "payment", payment.get({ plain: true }));
      }

      broadcast("removeProposal", id);

      await proposal.destroy({ transaction });
      res.end();
    });
  })
);

app.post(
  "/orders",
  auth,
  ah(async (req, res) => {
    try {
      const { user } = req;

      let { a1, v1, a2, v2 } = req.body;

      let rate = v2 / v1;

      const b = await lq.getBalance();

      Object.keys(b).map(asset => {
        assets[asset] = asset;
      });

      assets[config.liquid.btcasset] = "bitcoin";
      assets[
        "ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2"
      ] = "tether";
      assets[
        "a0c358a0f6947864af3a06f3f6a2aeb304df7fd95c922f2f22d7412399ce7691"
      ] = "adamcoin";

      if (!assets[a1]) throw new Error("unsupported asset");
      if (v1 > Math.round(b[assets[a1]] * SATS))
        throw new Error(`insufficient server funds, ${v1} ${b[assets[a1]]}`);

      await db.transaction(async transaction => {
        let a1acc = await getAccount(a1, user, transaction);
        let a2acc = await getAccount(a2, user, transaction);

        if (v1 > a1acc.balance)
          throw new Error(`insufficient funds, ${v1} ${a1acc.balance}`);

        l.info(
          `trade ${v1} ${a1.substr(0, 6)} for ${v2} ${a2.substr(0, 6)}`,
          user.username
        );

        await a1acc.decrement({ balance: v1 }, { transaction });
        await a1acc.reload({ transaction });

        let payment = await db.Payment.create(
          {
            hash: "Trade Funding",
            amount: -v1,
            account_id: a1acc.id,
            user_id: user.id,
            currency: user.currency,
            rate: app.get("rates")[user.currency],
            confirmed: true,
            received: false,
            network: "COINOS"
          },
          { transaction }
        );

        emit(user.username, "payment", payment.get({ plain: true }));
        emit(user.username, "account", a1acc.get({ plain: true }));

        const proposals = await db.Proposal.findAll(
          {
            where: {
              "$acc1.asset$": a2,
              "$acc2.asset$": a1,
              rate: { [Op.lte]: v1 / v2 },
              accepted: false
            },
            order: [
              ["rate", "ASC"],
              ["id", "ASC"]
            ],
            include: [
              {
                model: db.User,
                as: "user"
              },
              {
                model: db.Account,
                as: "acc1"
              },
              {
                model: db.Account,
                as: "acc2"
              }
            ]
          },
          { transaction }
        );

        for (let i = 0; i < proposals.length; i++) {
          if (!v1) break;
          p = proposals[i];
          if (p.v2 > v1) {
            p.v2 -= v1;
            await p.save({ transaction });

            let payment = await db.Payment.create(
              {
                hash: "Trade Fill",
                amount: v2,
                account_id: p.a1_id,
                user_id: p.user_id,
                currency: p.user.currency,
                rate: app.get("rates")[p.user.currency],
                confirmed: true,
                received: true,
                network: "COINOS"
              },
              { transaction }
            );

            await p.acc1.increment({ balance: v2 }, { transaction });
            await p.acc1.reload({ transaction });

            emit(p.user.username, "payment", payment.get({ plain: true }));
            emit(p.user.username, "account", p.acc1.get({ plain: true }));

            payment = await db.Payment.create(
              {
                hash: "Trade Fill",
                amount: v1,
                account_id: a1acc.id,
                user_id: user.id,
                currency: user.currency,
                rate: app.get("rates")[user.currency],
                confirmed: true,
                received: true,
                network: "COINOS"
              },
              { transaction }
            );

            a1acc.increment({ balance: v1 }, { transaction });
            await a1acc.reload({ transaction });

            emit(user.username, "payment", payment.get({ plain: true }));
            emit(user.username, "account", a1acc.get({ plain: true }));

            if (p.fee) {
              const btc = await getAccount(
                config.liquid.btcasset,
                p.user,
                transaction
              );

              payment = await db.Payment.create(
                {
                  hash: "Swap Fee Refund",
                  amount: p.fee,
                  account_id: btc.id,
                  user_id: p.user_id,
                  currency: p.user.currency,
                  rate: app.get("rates")[p.user.currency],
                  confirmed: true,
                  received: true,
                  network: "COINOS"
                },
                { transaction }
              );

              await btc.increment({ balance: p.fee }, { transaction });
              await btc.reload({ transaction });
            }

            emit(p.user.username, "payment", payment.get({ plain: true }));
            emit(p.user.username, "account", btc.get({ plain: true }));

            p = p.get({ plain: true });
            p.a1 = p.acc1.asset;
            p.a2 = p.acc2.asset;
            broadcast("proposal", shallow(p));
            v1 = 0;
          } else {
            v1 -= p.v2;

            p.accepted = true;
            p.completedAt = new Date();

            await p.save({ transaction });

            let payment = await db.Payment.create(
              {
                hash: "Trade Fill",
                amount: p.v1,
                account_id: a2acc.id,
                user_id: user.id,
                currency: user.currency,
                rate: app.get("rates")[user.currency],
                confirmed: true,
                received: true,
                network: "COINOS"
              },
              { transaction }
            );

            await a2acc.increment({ balance: p.v1 }, { transaction });
            await a2acc.reload({ transaction });

            emit(user.username, "payment", payment.get({ plain: true }));
            emit(user.username, "account", a2acc.get({ plain: true }));

            payment = await db.Payment.create(
              {
                hash: "Trade Fill",
                amount: p.v2,
                account_id: p.a2_id,
                user_id: p.user_id,
                currency: p.user.currency,
                rate: app.get("rates")[p.user.currency],
                confirmed: true,
                received: true,
                network: "COINOS"
              },
              { transaction }
            );

            emit(p.user.username, "payment", payment.get({ plain: true }));
            await p.acc2.increment({ balance: p.v2 }, { transaction });
            await p.acc2.reload({ transaction });

            p = p.get({ plain: true });
            p.a1 = p.acc1.asset;
            p.a2 = p.acc2.asset;
            broadcast("proposal", shallow(p));
          }
        }

        let proposal;
        if (v1) {
          proposal = await db.Proposal.create(
            {
              v1,
              v2,
              user_id: user.id,
              a1_id: a1acc.id,
              a2_id: a2acc.id
            },
            { transaction }
          );

          const text = await new Promise((resolve, reject) => {
            l.info(
              "running liquid-cli tool %s %s %s %s %s",
              config.liquid.conf,
              a1,
              v1,
              a2,
              v2
            );
            const proc = cli(
              "propose",
              a1,
              (v1 / SATS).toFixed(8),
              a2,
              (v2 / SATS).toFixed(8)
            );

            proc.stdout.on("data", data => {
              resolve(data.toString());
            });

            proc.stderr.on("error", err => {
              l.error("proposal error", err.toString());
              reject(err.toString());
            });

            proc.on("close", (code, signal) => {
              let msg =
                (code && code.toString()) || (signal && signal.toString());
              reject(
                new Error(
                  `Liquid swap tool process closed unexpectedly: ${msg}`
                )
              );
            });

            proc.on("exit", (code, signal) => {
              let msg =
                (code && code.toString()) || (signal && signal.toString());
              reject(
                new Error(
                  `Liquid swap tool process exited unexpectedly: ${msg}`
                )
              );
            });

            setTimeout(
              () => reject(new Error("Liquid swap tool timed out"), proc),
              timeout
            );
          });

          const filename = `proposal-${proposal.id}.txt`;

          fs.writeFileSync(swapsdir + filename, text);
          let info = JSON.parse(await getInfo(filename));
          let [fee, rate, asset] = parse(info);

          const btc = await getAccount(
            config.liquid.btcasset,
            user,
            transaction
          );
          fee = Math.round(fee * SATS);
          await btc.decrement({ balance: fee }, { transaction });
          await btc.save({ transaction });
          emit(user.username, "account", btc.get({ plain: true }));

          let payment = await db.Payment.create(
            {
              hash: "Swap Fee Deposit",
              amount: -fee,
              account_id: btc.id,
              user_id: user.id,
              currency: user.currency,
              rate: app.get("rates")[user.currency],
              confirmed: true,
              received: false,
              network: "COINOS"
            },
            { transaction }
          );

          emit(user.username, "payment", payment.get({ plain: true }));

          proposal.fee = fee;
          proposal.text = text;
          await proposal.save({ transaction });

          proposal = proposal.get({ plain: true });
          proposal.rate = v2 / v1;
          proposal.a1 = a1;
          proposal.a2 = a2;

          broadcast("proposal", proposal);
        }
      });

      res.end();
    } catch (e) {
      l.error(req.user.username, e.message, e.stack);
      res.status(500).send(e.message);
    }
  })
);

app.post(
  "/accept",
  optionalAuth,
  ah(async (req, res) => {
    try {
      const { id, text } = req.body;

      let proposal = await db.Proposal.findOne({
        where: {
          id
        },
        include: {
          model: db.User,
          as: "user"
        }
      });

      if (!proposal) throw new Error("Proposal not found");

      const { user } = req;

      if (text) {
        const filename = `acceptance-${id}.txt`;
        fs.writeFileSync(swapsdir + filename, text);

        let info = JSON.parse(await getInfo(filename));
        let [fee, rate, asset] = parse(info);
        let { tx, u_address_p, u_address_r } = JSON.parse(
          Buffer.from(text, "base64").toString()
        );
        const sha256 = crypto.createHash("sha256");
        sha256.update(tx);
        const hash = sha256.digest("hex");

        const leg1 = info.legs.find(leg => !leg.incoming);
        const leg2 = info.legs.find(leg => leg.incoming);

        await db.transaction(async transaction => {
          const l1a2 = await getAccount(leg1.asset, proposal.user, transaction);
          const l2a2 = await getAccount(leg2.asset, proposal.user, transaction);

          const btc = await getAccount(
            config.liquid.btcasset,
            proposal.user,
            transaction
          );

          let amount = Math.round(leg1.amount * SATS);
          fee = Math.round(fee * SATS);

          await l1a2.decrement({ balance: amount }, { transaction });
          await l1a2.reload({ transaction });

          await btc.decrement({ balance: fee }, { transaction });
          await btc.reload({ transaction });

          let payment = await db.Payment.create({
            hash,
            amount: -amount,
            account_id: l1a2.id,
            fee,
            memo: "Atomic Swap",
            user_id: proposal.user_id,
            currency: proposal.user.currency,
            rate: app.get("rates")[proposal.user.currency],
            address: u_address_r,
            confirmed: true,
            received: false,
            network: "liquid"
          });

          amount = Math.round(leg2.amount * SATS);

          await db.Invoice.create({
            user_id: proposal.user_id,
            text: u_address_p,
            address: u_address_p,
            unconfidential: u_address_p,
            currency: proposal.user.currency,
            memo: "Atomic Swap",
            rate: app.get("rates")[proposal.user.currency],
            amount,
            tip: 0,
            network: "liquid",
            account_id: l2a2.id
          });

          addresses[u_address_p] = proposal.user.username;

          await finalize(filename);
          await l1a2.save({ transaction });
          await btc.save({ transaction });

          proposal.accepted = true;
          proposal.completedAt = new Date();
          await proposal.save({ transaction });

          payment = payment.get({ plain: true });
          payment.account = l1a2.get({ plain: true });

          emit(proposal.user.username, "payment", payment);
          emit(proposal.user.username, "account", l1a2);
          emit(proposal.user.username, "account", btc);

          proposal = proposal.get({ plain: true });
          proposal.a1 = leg1.asset;
          proposal.a2 = leg2.asset;
          broadcast("proposal", shallow(proposal));
        });

        res.send(info);
      } else {
        throw new Error("no acceptance provided");
      }
    } catch (e) {
      l.error(e.message);
      res.status(500).send(e.message);
    }
  })
);

app.post(
  "/acceptance",
  ah(async (req, res) => {
    const { acceptance: text } = req.body;
    l.info("acceptance received");

    fs.writeFile(swapsdir + "accepted.txt", text, async err => {
      if (err) {
        return res.status(500).send(err);
      }

      try {
        let info = JSON.parse(
          await new Promise((resolve, reject) => {
            const proc = cli("info", swapsdir + "accepted.txt");

            proc.stdout.on("data", data => {
              resolve(data.toString());
            });

            proc.stderr.on("data", err => {
              reject(err.toString());
            });

            setTimeout(
              () => reject(new Error("Liquid swap tool timed out"), proc),
              timeout
            );
          })
        );

        const time = Math.floor(new Date()).toString();
        const [fee, rate, asset] = parse(info);
        if (!asset) throw new Error("unsupported asset");
        l.info("accepted", info, rate, asset);

        leveldb.put(time, JSON.stringify({ text, info, rate, asset }));
        l.info({ text, info, rate, asset });

        res.send({ info, rate });
      } catch (e) {
        l.error(e);
        res.status(500).send(e.message);
      }
    });
  })
);

checkQueue = async () => {
  const ws = app.get("ws");
  const txs = [];

  leveldb
    .createReadStream()
    .on("data", async function(data) {
      txs.push({ ...JSON.parse(data.value), key: data.key });
    })
    .on("end", async function(data) {
      const rate = (a, b) => a.rate - b.rate;
      const time = (a, b) => b.time - a.time;

      const pending = txs.filter(tx => !tx.id);
      const completed = txs.filter(tx => tx.id).sort(time);

      const bitcoin = pending
        .filter(tx => tx.asset === "bitcoin")
        .sort(rate)
        .reverse();
      const tether = pending
        .filter(tx => tx.asset === "tether")
        .sort(rate)
        .reverse();

      const strip = a =>
        a.map(({ id, key, info, rate, time }) => ({
          id,
          key,
          info,
          rate,
          time
        }));

      ws &&
        ws.send(
          JSON.stringify({
            completed: strip(completed.slice(0, 3)),
            bitcoin: strip(bitcoin.slice(0, 3)),
            tether: strip(tether.slice(0, 3))
          })
        );

      let b, t, tx;
      if (bitcoin[0]) b = bitcoin[0].rate - app.get("ask");
      if (tether[0]) t = tether[0].rate - 1 / app.get("bid");

      if (b > 0 || t > 0) {
        if ((b && !t) || b > t) tx = bitcoin[0];
        if ((t && !b) || t > b) tx = tether[0];
      }

      if (tx) {
        try {
          tx.id = JSON.parse(await finalize(tx.text)).txid;
          tx.time = Date.now();
          delete tx.text;
          leveldb.put(tx.key, JSON.stringify(tx));
        } catch (e) {
          l.info(e);
          if (e.includes("Unexpected fees")) leveldb.del(tx.key);
          if (e.includes("unsigned inputs")) leveldb.del(tx.key);
          if (e.includes("insufficient fee")) leveldb.del(tx.key);
        }
      }
    });
};

const parse = info => {
  const fee = info.legs[0].fee;
  return [
    fee,
    (info.legs[1].amount / (info.legs[0].amount + fee)).toFixed(8),
    assets[info.legs[0].asset]
  ];
};

const finalize = (filename = "finalized.txt", text) => {
  if (text) fs.writeFileSync(swapsdir + filename, text);

  return new Promise((resolve, reject) => {
    const proc = cli("finalize", swapsdir + filename, "-s");

    proc.stdout.on("data", data => {
      resolve(data.toString());
    });

    proc.stderr.on("data", err => {
      reject(new Error(err.toString()));
    });

    proc.on("close", (code, signal) => {
      let msg = (code && code.toString()) || (signal && signal.toString());
      reject(new Error(`Liquid swap tool process closed unexpectedly: ${msg}`));
    });

    proc.on("exit", (code, signal) => {
      let msg = (code && code.toString()) || (signal && signal.toString());
      reject(new Error(`Liquid swap tool process exited unexpectedly: ${msg}`));
    });

    setTimeout(
      () => reject(new Error("Liquid swap tool timed out"), proc),
      timeout
    );
  });
};

app.get(
  "/proposals",
  optionalAuth,
  ah(async (req, res) => {
    try {
      let proposals = await db.Proposal.findAll({
        attributes: {
          include: [
            [col("acc1.asset"), "a1"],
            [col("acc2.asset"), "a2"]
          ]
        },
        include: [
          {
            model: db.Account,
            as: "acc1",
            attributes: []
          },
          {
            model: db.Account,
            as: "acc2",
            attributes: []
          }
        ]
      });

      res.send(
        proposals.map(p => {
          if (p.user_id !== req.user.id) p.user_id = null;
          return p;
        })
      );
    } catch (e) {
      res.status(500).send(e.message);
    }
  })
);

app.post(
  "/publish",
  auth,
  ah(async (req, res) => {
    try {
      const { id } = req.body;
      await db.Proposal.update(
        { public: true },
        { where: { id, user_id: req.user.id } }
      );
      res.end();
    } catch (e) {
      res.status(500).send(e.message);
    }
  })
);
