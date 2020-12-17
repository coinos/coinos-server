const axios = require("axios");
const crypto = require("crypto");
const level = require("level");
const fs = require("fs");
const { spawn } = require("child_process");
const leveldb = level("leveldb");
const getAccount = require("../lib/account");
const { Op, col } = require("sequelize");
const uuidv4 = require("uuid/v4");

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

app.post(
  "/propose",
  auth,
  ah(async (req, res) => {
    const { a1, v1, a2, v2 } = req.body;

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
        l.error("order error", err.toString());
        reject(err.toString());
      });

      proc.on("close", (code, signal) => {
        let msg = (code && code.toString()) || (signal && signal.toString());
        reject(
          new Error(`Liquid swap tool process closed unexpectedly: ${msg}`)
        );
      });

      proc.on("exit", (code, signal) => {
        let msg = (code && code.toString()) || (signal && signal.toString());
        reject(
          new Error(`Liquid swap tool process exited unexpectedly: ${msg}`)
        );
      });

      setTimeout(
        () => reject(new Error("Liquid swap tool timed out"), proc),
        timeout
      );
    });

    res.send(text);
  })
);

const swap = async (user, { a1, a2, v1, v2 }) => {
  if (!parseInt(v1) || v1 < 0 || !parseInt(v2) || v2 < 0)
    throw new Error("Invalid amount");
  let rate = v2 / v1;

  const b = await lq.getBalance();

  Object.keys(b).map(asset => {
    assets[asset] = asset;
  });

  assets[config.liquid.btcasset] = "bitcoin";
  assets["ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2"] =
    "tether";
  assets["a0c358a0f6947864af3a06f3f6a2aeb304df7fd95c922f2f22d7412399ce7691"] =
    "adamcoin";

  if (!assets[a1]) throw new Error("Asset not found on server");
  if (v1 > Math.round(b[assets[a1]] * SATS))
    throw new Error(`Insufficient server funds, ${v1} ${b[assets[a1]]}`);

  await db.transaction(async transaction => {
    let a1acc = await getAccount(a1, user, transaction);
    let a2acc = await getAccount(a2, user, transaction);

    if (v1 > a1acc.balance)
      throw new Error(`Insufficient funds, ${v1} ${a1acc.balance}`);

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

    const orders = await db.Order.findAll(
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

    for (let i = 0; i < orders.length; i++) {
      if (!v1) break;
      let order = orders[i];
      if (order.v2 > v1) {
        let rate = order.rate;
        await order.decrement(
          {
            v2: v1
          },
          { transaction }
        );
        await order.save({ transaction });
        await order.reload({ transaction });
        order.v1 = Math.round(order.v2 / rate);
        await order.save({ transaction });

        await order.acc1.increment({ balance: v2 }, { transaction });
        await order.acc1.reload({ transaction });

        emit(order.user.username, "account", order.acc1.get({ plain: true }));

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

        if (order.fee) {
          const btc = await getAccount(
            config.liquid.btcasset,
            order.user,
            transaction
          );

          payment = await db.Payment.create(
            {
              hash: "Swap Fee Refund",
              amount: order.fee,
              account_id: btc.id,
              user_id: order.user_id,
              currency: order.user.currency,
              rate: app.get("rates")[order.user.currency],
              confirmed: true,
              received: true,
              network: "COINOS"
            },
            { transaction }
          );

          await btc.increment({ balance: order.fee }, { transaction });
          await btc.reload({ transaction });

          emit(order.user.username, "account", btc.get({ plain: true }));
        }

        emit(order.user.username, "payment", payment.get({ plain: true }));

        order = order.get({ plain: true });
        order.a1 = order.acc1.asset;
        order.a2 = order.acc2.asset;
        order.rate = order.v2 / order.v1;

        broadcast("order", shallow(order));
        v1 = 0;
      } else {
        v1 -= order.v2;
        v2 = Math.round(v1 * rate);

        order.accepted = true;
        order.completedAt = new Date();

        await order.save({ transaction });

        let payment = await db.Payment.create(
          {
            hash: "Trade Fill",
            amount: order.v1,
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

        await a2acc.increment({ balance: order.v1 }, { transaction });
        await a2acc.reload({ transaction });

        emit(user.username, "payment", payment.get({ plain: true }));
        emit(user.username, "account", a2acc.get({ plain: true }));

        payment = await db.Payment.create(
          {
            hash: "Trade Fill",
            amount: order.v2,
            account_id: order.a2_id,
            user_id: order.user_id,
            currency: order.user.currency,
            rate: app.get("rates")[order.user.currency],
            confirmed: true,
            received: true,
            network: "COINOS"
          },
          { transaction }
        );

        emit(order.user.username, "payment", payment.get({ plain: true }));
        await order.acc2.increment({ balance: order.v2 }, { transaction });
        await order.acc2.reload({ transaction });

        order = order.get({ plain: true });
        order.a1 = order.acc1.asset;
        order.a2 = order.acc2.asset;
        order.rate = order.v2 / order.v1;

        broadcast("order", shallow(order));
      }
    }

    let order;
    if (v1) {
      order = await db.Order.create(
        {
          v1,
          v2,
          user_id: user.id,
          a1_id: a1acc.id,
          a2_id: a2acc.id
        },
        { transaction }
      );

      order = order.get({ plain: true });
      order.rate = v2 / v1;
      order.a1 = a1;
      order.a2 = a2;

      broadcast("order", order);
    }
  });
};

const cancel = async (user, id) => {
  await db.transaction(async transaction => {
    let order = await db.Order.findOne(
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

    let { acc1: account, v1, v2 } = order;
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

    if (order.fee) {
      const btc = await getAccount(config.liquid.btcasset, user, transaction);

      payment = await db.Payment.create(
        {
          hash: "Swap Fee Refund",
          amount: order.fee,
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

      await btc.increment({ balance: order.fee }, { transaction });
      await btc.reload({ transaction });

      emit(user.username, "account", btc.get({ plain: true }));
      emit(user.username, "payment", payment.get({ plain: true }));
    }

    broadcast("removeOrder", id);
    await order.destroy({ transaction });
  });
};

app.delete(
  "/order/:id",
  auth,
  ah(async (req, res) => {
    const { id } = req.params;
    const { user } = req;

    await cancel(user, id);
    res.end();
  })
);

app.post(
  "/orders",
  auth,
  ah(async (req, res) => {
    const { user } = req;
    try {
      await swap(user, req.body);
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
      const { text } = req.body;
      const { user } = req;
      const id = uuidv4();

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

        let orders = await db.Order.findAll({
          where: {
            rate: { [Op.lte]: leg2.amount / leg1.amount },
            accepted: false,
            "$acc1.asset$": leg1.asset,
            "$acc2.asset$": leg2.asset
          },
          attributes: {
            include: [
              [col("acc1.asset"), "a1"],
              [col("acc2.asset"), "a2"]
            ]
          },
          order: [["rate", "DESC"]],
          include: [
            {
              model: db.User,
              as: "user"
            },
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

        let total = orders.reduce((a, b) => a + b.v1, 0);
        let remaining = Math.round(leg1.amount * SATS);
        if (total < remaining)
          throw new Error("Not enough coins for sale at that price");

        await db.transaction(async transaction => {
          for (let i = 0; i < orders.length; i++) {
            let order = orders[i];
            const account = await getAccount(
              leg1.asset,
              order.user,
              transaction
            );

            let { v1: amount } = order;
            if (remaining >= amount) {
              remaining -= amount;

              await db.Invoice.create({
                user_id: order.user_id,
                text: u_address_p,
                address: u_address_p,
                unconfidential: u_address_p,
                currency: order.user.currency,
                memo: "Atomic Swap",
                rate: app.get("rates")[order.user.currency],
                amount,
                tip: 0,
                network: "liquid",
                account_id: account.id
              });

              addresses[u_address_p] = order.user.username;

              order.accepted = true;
              order.completedAt = new Date();
              await order.save({ transaction });

              order = order.get({ plain: true });
              order.a1 = leg2.asset;
              order.a2 = leg1.asset;
              order.rate = order.v2 / order.v1;

              broadcast("order", shallow(order));
            } else {
              await db.Invoice.create({
                user_id: order.user_id,
                text: u_address_p,
                address: u_address_p,
                unconfidential: u_address_p,
                currency: order.user.currency,
                memo: "Atomic Swap",
                rate: app.get("rates")[order.user.currency],
                amount: remaining,
                tip: 0,
                network: "liquid",
                account_id: account.id
              });

              addresses[u_address_p] = order.user.username;

              order.decrement(
                {
                  v1: remaining,
                  v2: Math.round((order.v2 * remaining) / amount)
                },
                { transaction }
              );
              await order.save({ transaction });
              await order.reload({ transaction });

              order = order.get({ plain: true });
              order.a1 = leg2.asset;
              order.a2 = leg1.asset;
              order.rate = order.v2 / order.v1;

              broadcast("order", shallow(order));
            }
          }

          await finalize(filename);
        });

        res.send(info);
      } else {
        throw new Error("No acceptance provided");
      }
    } catch (e) {
      l.error(e.message, e.stack);
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
        if (!asset) throw new Error("Unsupported asset");
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
  "/orders",
  optionalAuth,
  ah(async (req, res) => {
    try {
      let orders = await db.Order.findAll({
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
        orders.map(order => {
          if (order.user_id !== req.user.id) order.user_id = null;
          return order;
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
      await db.Order.update(
        { public: true },
        { where: { id, user_id: req.user.id } }
      );
      res.end();
    } catch (e) {
      res.status(500).send(e.message);
    }
  })
);

if (config.maker)
  config.maker.map(({ amount, c1, c2, currency, askMultiplier, bidMultiplier }) => {
    setInterval(async () => {
      if (!app.get("rates")) return;

      const user = await db.User.findOne({
        where: {
          username: "maker"
        }
      });

      await db.transaction(async transaction => {
        let order = await db.Order.findOne(
          {
            where: {
              user_id: user.id,
              "$acc1.asset$": c1,
              "$acc2.asset$": c2,
              accepted: false
            },
            include: [
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

        let params = {
          a1: c1,
          a2: c2,
          v1: amount * SATS,
          v2: Math.round(
            amount *
              SATS *
              (((app.get("ask") * app.get("rates")[currency]) /
                app.get("rates")["USD"]) *
                askMultiplier)
          )
        };

        if (order) {
          let bestBid = await db.Order.findOne(
            {
              where: {
                "$acc1.asset$": c2,
                "$acc2.asset$": c1,
                accepted: false,
                id: {
                  [Op.ne]: order.id
                }
              },
              include: [
                {
                  model: db.Account,
                  as: "acc1"
                },
                {
                  model: db.Account,
                  as: "acc2"
                }
              ],
              order: [["rate", "DESC"]],
              limit: 1
            },
            { transaction }
          );
          if (
            !bestBid ||
            (params.v2 / params.v1 > bestBid.rate &&
              order.acc2.balance >= params.v2)
          ) {
            order.v1 = params.v1;
            order.v2 = params.v2;
            await order.save();
            order = order.get({ plain: true });
            order.a1 = params.a1;
            order.a2 = params.a2;
            order.rate = order.v2 / order.v1;

            broadcast("order", shallow(order));
          }
        } else {
          try {
            await swap(user, params);
          } catch (e) {
            l.warn("Failed to make ask", e.message);
          }
        }

        order = await db.Order.findOne(
          {
            where: {
              user_id: user.id,
              "$acc1.asset$": c2,
              "$acc2.asset$": c1,
              accepted: false
            },
            include: [
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

        params = {
          a1: c2,
          a2: c1,
          v1: Math.round(
            amount *
              SATS *
              ((app.get("bid") * app.get("rates")[currency]) /
                app.get("rates")["USD"]) *
              bidMultiplier
          ),
          v2: amount * SATS
        };

        if (order) {
          let bestAsk = await db.Order.findOne(
            {
              where: {
                "$acc1.asset$": c1,
                "$acc2.asset$": c2,
                accepted: false,
                id: {
                  [Op.ne]: order.id
                }
              },
              include: [
                {
                  model: db.Account,
                  as: "acc1"
                },
                {
                  model: db.Account,
                  as: "acc2"
                }
              ],
              order: [["rate", "ASC"]],
              limit: 1
            },
            { transaction }
          );

          if (bestAsk)
            if (
              !bestAsk ||
              (params.v1 / params.v2 < bestAsk.rate &&
                order.acc1.balance >= params.v1)
            ) {
              order.v1 = params.v1;
              order.v2 = params.v2;
              await order.save();
              order = order.get({ plain: true });
              order.a1 = params.a1;
              order.a2 = params.a2;
              order.rate = order.v2 / order.v1;

              broadcast("order", shallow(order));
            } else {
              broadcast("removeOrder", order.id);
              await order.destroy({ transaction });
            }
        } else {
          try {
            await swap(user, params);
          } catch (e) {
            l.warn("Failed to make bid", e.message);
          }
        }
      });
    }, 5000);
  });
