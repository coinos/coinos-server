const level = require("level");
const fs = require("fs");
const { spawn } = require("child_process");
const leveldb = level("leveldb");

const assets = {
  b2e15d0d7a0c94e4e2ce0fe6e8691b9e451377f6e46e8045a86f7c4b5d4f0f23: "bitcoin",
  "4eebe36eb0819e6daa5dd3c97733251ff4eb728c810d949365d6dacaad5ef6e8": "tether",
};

const createProposal = (a1, v1, a2, v2) =>
  new Promise((resolve, reject) => {
    l.info("running liquid-cli tool %s %s %s %s %s", config.liquid.conf, a1, v1, a2, v2);
    const proc = spawn("liquidswap-cli", [
      "--regtest",
      "-c",
      config.liquid.conf,
      "propose",
      a1,
      v1,
      a2,
      v2,
    ]);

    proc.stdout.on("data", (data) => {
      fs.writeFile("proposal.txt", data.toString(), function (err) {
        if (err) {
          return l.error(err);
        }
        l.info("proposal.txt file saved");
      });
      resolve(data.toString());
    });

    proc.stderr.on("error", (err) => {
      l.error("proposal error", err.toString());
      reject(err.toString());
    });
  });

const getInfo = () =>
  new Promise((resolve, reject) => {
    const spawn = require("child_process").spawn;
    const proc = spawn("liquidswap-cli", [
      "--regtest",
      "-c",
      config.liquid.conf,
      "info",
      "proposal.txt",
    ]);

    proc.stdout.on("data", (data) => {
      resolve(data.toString());
    });

    proc.stderr.on("data", (err) => {
      l.error("info error", err.toString());
      reject(err.toString());
    });

    setTimeout(() => reject("timeout"), 2000);
  });

app.get("/proposal", auth, async (req, res) => {
  try {
    const { user } = req;
    const { a1, v1, a2, v2 } = req.query;
    const b = app.get("balance");

    Object.keys(b).map((asset) => {
      assets[asset] = asset;
    });
    assets["b2e15d0d7a0c94e4e2ce0fe6e8691b9e451377f6e46e8045a86f7c4b5d4f0f23"] =
      "bitcoin";

    if (!(assets[a1] && assets[a2])) throw new Error("unsupported assets");
    if (v1 > b[assets[a1]]) throw new Error("not enough funds");

    l.info(
      `proposal requested to swap ${v1} ${assets[a1]} for ${v2} ${assets[a2]}`
    );

    let proposal = await createProposal(a1, v1, a2, v2);
    proposal = proposal.replace(/\s+/g, "").trim();

    const info = JSON.parse(await getInfo());
    const [fee, rate, asset] = parse(info);

    if (!rate) throw new Error("invalid asset pair");
    if (rate < 0)
      throw new Error(`${assets[a1]} amount must be greater than ${fee}`);

    await db.Proposal.create({
      a1,
      a2,
      v1: Math.round(v1 * SATS),
      v2: Math.round(v2 * SATS),
      user_id: user.id,
      text: proposal,
    }); 

    res.send({ proposal, info, rate, asset });
  } catch (e) {
    l.error(e);
    res.status(500).send({ error: e.message });
  }
});

app.post("/acceptance", async (req, res) => {
  const { acceptance: text } = req.body;
  l.info("acceptance received");

  fs.writeFile("accepted.txt", text, async (err) => {
    if (err) {
      return res.status(500).send(err);
    }

    try {
      let info = JSON.parse(
        await new Promise((resolve, reject) => {
          const spawn = require("child_process").spawn;
          const proc = spawn("liquidswap-cli", [
            "--regtest",
            "-c",
            config.liquid.conf,
            "info",
            "accepted.txt",
          ]);

          proc.stdout.on("data", (data) => {
            resolve(data.toString());
          });

          proc.stderr.on("data", (err) => {
            reject(err.toString());
          });

          setTimeout(() => reject("timeout", proc), 2000);
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
});

checkQueue = async () => {
  const ws = app.get("ws");
  const txs = [];

  leveldb.createReadStream()
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

const finalize = (text) => {
  fs.writeFileSync("accepted.txt", text);

  return new Promise((resolve, reject) => {
    const spawn = require("child_process").spawn;
    const proc = spawn("liquidswap-cli", [
      "--regtest",
      "-c",
      config.liquid.conf,
      "finalize",
      "accepted.txt",
      "--send",
    ]);

    proc.stdout.on("data", (data) => {
      resolve(data.toString());
    });

    proc.stderr.on("data", (err) => {
      reject(err.toString());
    });

    setTimeout(() => reject("timeout"), 2000);
  });
};
