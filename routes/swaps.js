const axios = require("axios");
const crypto = require("crypto");
const level = require("level");
const fs = require("fs");
const { spawn } = require("child_process");
const leveldb = level("leveldb");
const getAccount = require("../lib/account");

const assets = {
  b2e15d0d7a0c94e4e2ce0fe6e8691b9e451377f6e46e8045a86f7c4b5d4f0f23: "bitcoin",
  "4eebe36eb0819e6daa5dd3c97733251ff4eb728c810d949365d6dacaad5ef6e8": "tether",
};

const swapsdir = 'swaps/';
if (!fs.existsSync(swapsdir)){
    fs.mkdirSync(swapsdir);
}

const timeout = 20000;

const cli = (...args) => {
  const params = ["--regtest", "-c", config.liquid.conf, ...args];
  if (config.liquid.network !== "regtest") params.shift();
  l.info("spawning liquidswap-cli with params:", params);
  return spawn("liquidswap-cli", params);
};

const createProposal = (a1, v1, a2, v2) =>
  new Promise((resolve, reject) => {
    l.info(
      "running liquid-cli tool %s %s %s %s %s",
      config.liquid.conf,
      a1,
      v1,
      a2,
      v2
    );
    const proc = cli("propose", a1, v1, a2, v2);

    proc.stdout.on("data", (data) => {
      resolve(data.toString());
    });

    proc.stderr.on("error", (err) => {
      l.error("proposal error", err.toString());
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

    setTimeout(() => reject(new Error("Liquid swap tool timed out"), proc), timeout);
  });

const getInfo = (filename) =>
  new Promise((resolve, reject) => {
    const proc = cli("info", swapsdir + filename);

    proc.stdout.on("data", (data) => {
      resolve(data.toString());
    });

    proc.stderr.on("data", (err) => {
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

    setTimeout(() => reject(new Error("Liquid swap tool timed out"), proc), timeout);
  });

app.delete("/proposal/:id", auth, ah(async (req, res) => {
  const { id } = req.params;
  await db.Proposal.destroy({
    where: {
      id,
      user_id: req.user.id,
    },
  });
  res.end();
}));

app.get("/proposal", auth, ah(async (req, res) => {
  try {
    const { user } = req;
    const { a1, v1, a2, v2 } = req.query;
    const b = await lq.getBalance();

    Object.keys(b).map((asset) => {
      assets[asset] = asset;
    });
    assets["ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2"] = "tether";
    assets["6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d"] = "bitcoin";
    assets["a0c358a0f6947864af3a06f3f6a2aeb304df7fd95c922f2f22d7412399ce7691"] = "adamcoin";

    if (!assets[a1]) throw new Error("unsupported asset");
    if (v1 > b[assets[a1]]) throw new Error("insufficient server funds");
    const account = await db.Account.findOne({
      where: {
        user_id: user.id,
        asset: a1,
      },
    });
    if (v1 > account.balance) throw new Error("insufficient funds");

    l.info(
      `proposal requested to swap ${v1} ${assets[a1]} for ${v2} ${assets[a2]}`
    );

    let text = await createProposal(a1, v1, a2, v2);
    text = text.replace(/\s+/g, "").trim();

    const proposal = await db.Proposal.create({
      a1,
      a2,
      v1: Math.round(v1 * SATS),
      v2: Math.round(v2 * SATS),
      user_id: user.id,
      text,
    });

    res.send({ proposal });
  } catch (e) {
    l.error(e.message);
    res.status(500).send({ error: e.message });
  }
}));

app.post("/accept", optionalAuth, ah(async (req, res) => {
  try {
    const { id, text } = req.body;

    const proposal = await db.Proposal.findOne({
      where: {
        id,
        accepted: false,
      },
      include: {
        model: db.User,
        as: "user",
      },
    });

    if (!proposal) throw new Error("Proposal not found");

    const filename = `proposal-${id}.txt`;

    fs.writeFileSync(swapsdir + filename, proposal.text);
    let info = JSON.parse(await getInfo(filename));

    const { user } = req;

    if (user) {
      let [fee, rate, asset] = parse(info);
      const leg1 = info.legs.find((leg) => !leg.incoming && leg.funded);
      const leg2 = info.legs.find((leg) => leg.incoming && !leg.funded);
      await db.transaction(async (transaction) => {
        const l1a1 = await getAccount(leg1.asset, user);
        const l1a2 = await getAccount(leg1.asset, proposal.user);

        let amount = Math.round(leg1.amount * SATS);
        if (amount > l1a2.balance)
          throw new Error(`Proposer has insufficient funds: ${amount}, ${l1a2.balance}`);

        l1a1.balance += amount;
        l1a2.balance -= amount;

        let l1a1p = await db.Payment.create({
          hash: "Internal Transfer",
          amount,
          account_id: l1a1.id,
          memo: "Atomic Swap",
          user_id: user.id,
          currency: user.currency,
          rate,
          confirmed: true,
          received: true,
          network: "COINOS",
        });

        let l1a2p = await db.Payment.create({
          hash: "Internal Transfer",
          amount: -amount,
          account_id: l1a2.id,
          memo: "Atomic Swap",
          user_id: proposal.user_id,
          currency: proposal.user.currency,
          rate,
          confirmed: true,
          received: false,
          network: "COINOS",
        });

        const l2a1 = await getAccount(leg2.asset, user);
        const l2a2 = await getAccount(leg2.asset, proposal.user);

        amount = Math.round(leg2.amount * SATS);
        if (amount > l2a1.balance) throw new Error("Insufficient funds");

        l2a1.balance -= amount;
        l2a2.balance += amount;

        let l2a1p = await db.Payment.create({
          hash: "Internal Transfer",
          amount: -amount,
          account_id: l2a1.id,
          memo: "Atomic Swap",
          user_id: user.id,
          currency: user.currency,
          rate,
          confirmed: true,
          received: false,
          network: "COINOS",
        });

        let l2a2p = await db.Payment.create({
          hash: "Internal Transfer",
          amount,
          account_id: l2a2.id,
          memo: "Atomic Swap",
          user_id: proposal.user_id,
          currency: proposal.user.currency,
          rate,
          confirmed: true,
          received: true,
          network: "COINOS",
        });

        await l1a1.save({ transaction });
        await l1a2.save({ transaction });
        await l2a1.save({ transaction });
        await l2a2.save({ transaction });

        proposal.accepted = true;
        await proposal.save({ transaction });

        l1a1p = l1a1p.get({ plain: true });
        l1a1p.account = l1a1.get({ plain: true });
        l1a2p = l1a2p.get({ plain: true });
        l1a2p.account = l1a2.get({ plain: true });
        l2a1p = l2a1p.get({ plain: true });
        l2a1p.account = l2a1.get({ plain: true });
        l2a2p = l2a2p.get({ plain: true });
        l2a2p.account = l2a2.get({ plain: true });

        emit(user.username, "account", l1a1);
        emit(user.username, "account", l2a1);
        emit(proposal.user.username, "account", l1a2);
        emit(proposal.user.username, "account", l2a2);
        emit(user.username, "payment", l1a1p);
        emit(user.username, "payment", l2a1p);
        emit(proposal.user.username, "payment", l1a2p);
        emit(proposal.user.username, "payment", l2a2p);
        emit(user.username, "proposal", proposal);
        emit(proposal.user.username, "proposal", proposal);
      });
    } else if (text) {
      const filename = `acceptance-${id}.txt`;
      fs.writeFileSync(swapsdir + filename, text);

      info = JSON.parse(await getInfo(filename));
      let [fee, rate, asset] = parse(info);
      let { tx, u_address_p, u_address_r } = JSON.parse(
        Buffer.from(text, "base64").toString()
      );
      const sha256 = crypto.createHash("sha256");
      sha256.update(tx);
      const hash = sha256.digest("hex");

      const leg1 = info.legs.find((leg) => !leg.incoming);
      const leg2 = info.legs.find((leg) => leg.incoming);

      const l1a2 = await getAccount(leg1.asset, proposal.user);
      const btc = await getAccount(config.liquid.btcasset, proposal.user);

      await db.transaction(async (transaction) => {

        let amount = Math.round(leg1.amount * SATS);
        fee = Math.round(fee * SATS);

        if (amount > l1a2.balance)
          throw new Error(`Proposer has insufficient funds: ${amount}, ${l1a2.balance}`);

        if (fee > btc.balance)
          throw new Error(`Proposer has insufficient funds for fee: ${fee}, ${btc.balance}`);

        l1a2.balance -= amount;
        btc.balance -= fee;

        let payment = await db.Payment.create({
          hash,
          amount: -amount,
          account_id: l1a2.id,
          fee,
          memo: "Atomic Swap",
          user_id: proposal.user_id,
          currency: proposal.user.currency,
          rate,
          address: u_address_r,
          confirmed: true,
          received: false,
          network: "LBTC",
        });

        amount = Math.round(leg2.amount * SATS);

        await db.Invoice.create({
          user_id: proposal.user_id,
          text: u_address_p,
          currency: proposal.user.currency,
          memo: "Atomic Swap",
          rate,
          amount,
          tip: 0,
          network: "LBTC",
        });

        addresses[u_address_p] = proposal.user.username;

        await finalize(filename);
        await l1a2.save({ transaction });
        await btc.save({ transaction });

        proposal.accepted = true;
        await proposal.save({ transaction });

        payment = payment.get({ plain: true });
        payment.account = l1a2.get({ plain: true });

        emit(proposal.user.username, "payment", payment);
        emit(proposal.user.username, "account", l1a2);
        emit(proposal.user.username, "account", btc);
        emit(proposal.user.username, "proposal", proposal);
      });
    } else {
      throw new Error("no acceptance provided");
    }

    res.send(info);
  } catch (e) {
    l.error(e.message);
    res.status(500).send(e.message);
  }
}));

app.post("/acceptance", ah(async (req, res) => {
  const { acceptance: text } = req.body;
  l.info("acceptance received");

  fs.writeFile(swapsdir + "accepted.txt", text, async (err) => {
    if (err) {
      return res.status(500).send(err);
    }

    try {
      let info = JSON.parse(
        await new Promise((resolve, reject) => {
          const proc = cli("info", swapsdir + "accepted.txt");

          proc.stdout.on("data", (data) => {
            resolve(data.toString());
          });

          proc.stderr.on("data", (err) => {
            reject(err.toString());
          });

          setTimeout(() => reject(new Error("Liquid swap tool timed out"), proc), timeout);
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
      res.status(500).send({ error: e });
    }
  });
}));

checkQueue = async () => {
  const ws = app.get("ws");
  const txs = [];

  leveldb
    .createReadStream()
    .on("data", async function (data) {
      console.log("pushing", data.key);
      txs.push({ ...JSON.parse(data.value), key: data.key });
    })
    .on("end", async function (data) {
      const rate = (a, b) => a.rate - b.rate;
      const time = (a, b) => b.time - a.time;

      const pending = txs.filter((tx) => !tx.id);
      const completed = txs.filter((tx) => tx.id).sort(time);

      const bitcoin = pending
        .filter((tx) => tx.asset === "bitcoin")
        .sort(rate)
        .reverse();
      const tether = pending
        .filter((tx) => tx.asset === "tether")
        .sort(rate)
        .reverse();

      const strip = (a) =>
        a.map(({ id, key, info, rate, time }) => ({
          id,
          key,
          info,
          rate,
          time,
        }));

      ws &&
        ws.send(
          JSON.stringify({
            completed: strip(completed.slice(0, 3)),
            bitcoin: strip(bitcoin.slice(0, 3)),
            tether: strip(tether.slice(0, 3)),
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

const parse = (info) => {
  const fee = info.legs[0].fee;
  return [
    fee,
    (info.legs[1].amount / (info.legs[0].amount + fee)).toFixed(8),
    assets[info.legs[0].asset],
  ];
};

const finalize = (filename = "finalized.txt", text) => {
  if (text) fs.writeFileSync(swapsdir + filename, text);

  return new Promise((resolve, reject) => {
    const proc = cli("finalize", swapsdir + filename, "-s");

    proc.stdout.on("data", (data) => {
      resolve(data.toString());
    });

    proc.stderr.on("data", (err) => {
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

    setTimeout(() => reject(new Error("Liquid swap tool timed out"), proc), timeout);
  });
};

app.get("/proposals", optionalAuth, ah(async (req, res) => {
  try {
    if (req.user) {
      res.send(await db.Proposal.findAll());
    } else {
      res.send(
        await db.Proposal.findAll({
          attributes: { exclude: ["user_id"] },
          where: {
            accepted: false,
          },
        })
      );
    }
  } catch (e) {
    res.status(500).send(e.message);
  }
}));

app.post("/publish", auth, ah(async (req, res) => {
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
}));

