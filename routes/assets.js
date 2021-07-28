const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");

let fetchAssets;
(fetchAssets = async () => {
  try {
    const { data: assets } = await axios.get(
      "https://assets.blockstream.info/"
    );
    var liquid_assets = require("./../assets.json");
    app.set("assets", liquid_assets);
  } catch (e) {
    var liquid_assets = require("./../assets.json");
    if (liquid_assets) {
      app.set("assets", liquid_assets);
      console.debug("using static assets..." + e.message);
    } else {
      l.error("error fetching assets", e.message);
      res.status(500).send("error fetching assets");
    }
  }

  setTimeout(fetchAssets, 7200000);
})();

app.get(
  "/assets",
  ah(async (req, res) => {
    if (app.get("assets")) {
      const assets = app.get("assets");

      const accounts = await db.Account.findAll({
        // group: ["asset"]
      });
      Object.keys(assets).map(a => {
        assets[a].registered = true;
        if (!assets[a].asset) assets[a].asset = assets[a].asset_id;
        if (
          (assets[a].ticker === "BTC" &&
            assets[a].asset !== config.liquid.btcasset) ||
          (assets[a].ticker === "EUR" &&
            assets[a].asset !== config.liquid.eurasset) ||
          (assets[a].ticker === "CAD" &&
            assets[a].asset !== config.liquid.cadasset) ||
          (assets[a].ticker === "USDt" &&
            assets[a].asset !== config.liquid.usdtasset)
        )
          delete assets[a];
      });
      accounts.map(({ asset, name, domain, ticker, precision }) => {
        if (!assets[asset])
          assets[asset] = {
            asset,
            name,
            domain,
            ticker,
            precision
          };
      });

      res.send(assets);
    } else {
      console.log("error getting blockstream assets");
      res.status(500).send("Problem fetching blockstream asset registry data");
    }
  })
);

app.post(
  "/assets",
  auth,
  ah(async (req, res) => {
    try {
      const sha256 = crypto.createHash("sha256");
      const { id: user_id } = req.user;
      const blind = false;

      const {
        address,
        domain,
        name,
        asset_amount,
        filename,
        token_amount,
        precision,
        pubkey,
        ticker
      } = req.body;

      const asset_address = address
        ? address
        : await lq.getNewAddress("", "legacy");

      const token_address =
        token_amount && (await lq.getNewAddress("", "legacy"));

      const issuer_pubkey = pubkey
        ? pubkey
        : (await lq.getAddressInfo(asset_address)).pubkey;
      const version = 0;

      const contract = {
        entity: { domain },
        issuer_pubkey,
        name,
        precision,
        ticker,
        version
      };

      if (filename) contract.filename = filename;

      l.info("attempting issuance", req.user.username, contract);

      sha256.update(JSON.stringify(contract));
      const hash = sha256.digest("hex");
      const contract_hash = hash
        .match(/[a-f0-9]{2}/g)
        .reverse()
        .join("");
      const rawtx = await lq.createRawTransaction([], { data: "00" });
      const funded = await lq.fundRawTransaction(rawtx, { feeRate: 0.000002 });
      const params = {
        asset_amount,
        asset_address,
        blind,
        contract_hash
      };

      params.asset_amount = asset_amount / (SATS / 10 ** precision);

      if (token_amount) {
        params.token_amount = token_amount;
        params.token_address = token_address;
        params.token_amount = parseInt(params.token_amount);
      }

      let ria;
      try {
        ria = await lq.rawIssueAsset(funded.hex, [params]);
      } catch (e) {
        l.info(asset_amount, token_amount, params);
        throw new Error(e.message);
      }

      const { asset, hex, token } = ria[0];
      const brt = await lq.blindRawTransaction(hex, true, [], false);
      const srt = await lq.signRawTransactionWithWallet(brt);
      const allowed = (await lq.testMempoolAccept([srt.hex]))[0].allowed;
      fs.writeFileSync('tx', srt.hex);
      if (!allowed) throw new Error();
      const txid = await lq.sendRawTransaction(srt.hex);

      await db.transaction(async transaction => {
        let account = await db.Account.findOne({
          where: {
            user_id,
            asset: config.liquid.btcasset,
            pubkey: null
          },
          include: {
            model: db.User,
            as: "user"
          },
          transaction
        });

        let { user } = account;

        if (Math.round(funded.fee * SATS) > account.balance) {
          l.error(
            "amount exceeds balance",
            asset_amount,
            funded.fee,
            account.balance
          );
          throw new Error(`Insufficient funds to pay fee of ${funded.fee} BTC`);
        }

        await account.decrement(
          { balance: Math.round(funded.fee * SATS) },
          { transaction }
        );
        await account.reload({ transaction });
        emit(user.username, "account", account);

        account = await db.Account.create(
          {
            asset,
            contract,
            domain,
            user_id,
            ticker,
            precision,
            name,
            balance: 0,
            network: "liquid",
            pending: params.asset_amount * SATS
          },
          { transaction }
        );

        emit(user.username, "account", account);
        l.info(
          "issued asset",
          user.username,
          params.asset_amount,
          ticker,
          name
        );

        const asset_payment = await db.Payment.create(
          {
            account_id: account.id,
            user_id,
            hash: txid,
            amount: params.asset_amount * SATS,
            received: true,
            confirmed: false,
            address: asset_address,
            network: "liquid"
          },
          { transaction }
        );
        emit(user.username, "payment", asset_payment);

        issuances[txid] = {
          user_id,
          asset,
          asset_amount: params.asset_amount,
          asset_payment_id: asset_payment.id
        };

        if (token_amount) {
          account = await db.Account.create(
            {
              asset: token,
              user_id,
              domain,
              ticker: `${ticker}REISSUANCETOKEN`,
              precision: 8,
              name: `${name} Reissuance Token`,
              balance: 0,
              pending: token_amount * SATS
            },
            { transaction }
          );
          emit(user.username, "account", account);

          const token_payment = await db.Payment.create(
            {
              account_id: account.id,
              user_id,
              hash: txid,
              amount: token_amount * SATS,
              received: true,
              confirmed: false,
              address: token_address,
              network: "liquid"
            },
            { transaction }
          );
          emit(user.username, "payment", token_payment);

          issuances[txid].token = token;
          issuances[txid].token_amount = token_amount;
          issuances[txid].token_payment_id = token_payment.id;
        }
      });

      res.send(issuances[txid]);
    } catch (e) {
      l.error("asset issuance failed", e.message);
      res.status(500).send(e.message);
    }
  })
);

app.post(
  "/assets/register",
  auth,
  ah(async (req, res) => {
    const { asset } = req.body;
    const account = await db.Account.findOne({
      where: {
        user_id: req.user.id,
        asset
      }
    });

    try {
      const { data: result } = await axios.post(
        "https://assets.blockstream.info/",
        {
          asset_id: asset,
          contract: account.contract
        }
      );
      l.info("register asset result", req.user.username, result);
      res.send(result);
    } catch (e) {
      l.error("asset registration failed", e.message);
      res.status(500).send(e.message);
    }
  })
);

app.post(
  "/loadFaucet",
  auth,
  ah(async (req, res) => {
    return res.status(500).send("Faucet feature temporarily disabled");

    const { user } = req;
    const { asset, amount } = req.body;
    amount = parseInt(amount);

    try {
      await db.transaction(async transaction => {
        let account = await getAccount(
          config.liquid.btcasset,
          user,
          transaction
        );

        if (amount < 0) throw new Error("Amount to load cannot be negative");
        if (account.asset !== config.liquid.btcasset)
          throw new Error(
            "Faucet has to be funded with bitcoin. Try sending from another wallet."
          );
        if (account.balance < amount) throw new Error("Insufficient funds");

        let fee = 0;

        await account.decrement({ balance: amount }, { transaction });
        await account.reload({ transaction });

        let a2;
        let acc = {
          user_id: null,
          asset
        };

        a2 = await db.Account.findOne({
          where: acc,
          lock: transaction.LOCK.UPDATE,
          transaction
        });

        if (a2) {
          await a2.increment({ balance: amount }, { transaction });
          await a2.reload({ transaction });
        } else {
          let name = asset.substr(0, 6);
          let domain;
          let ticker = asset.substr(0, 3).toUpperCase();
          let precision = 8;

          const assets = app.get("assets");

          if (assets[asset]) {
            ({ domain, ticker, precision, name } = assets[asset]);
          } else {
            const existing = await db.Account.findOne({
              where: {
                asset
              },
              order: [["id", "ASC"]],
              limit: 1,
              lock: transaction.LOCK.UPDATE,
              transaction
            });

            if (existing) {
              ({ domain, ticker, precision, name } = existing);
            }
          }

          acc = { ...acc, ...{ domain, ticker, precision, name } };
          acc.balance = amount;
          acc.pending = 0;
          acc.network = "liquid";
          a2 = await db.Account.create(acc, { transaction });
        }

        let params = {
          amount: -amount,
          account_id: account.id,
          user_id: user.id,
          rate: app.get("rates")[user.currency],
          currency: user.currency,
          confirmed: true,
          hash: `Loaded Faucet - ${a2.ticker}`,
          network: "COINOS"
        };

        let payment = await db.Payment.create(params, { transaction });

        payment = payment.get({ plain: true });
        payment.account = account.get({ plain: true });

        l.info("sent internal", user.username, -payment.amount);

        emit(user.username, "payment", payment);
        emit(user.username, "account", account);
        emit(user.username, "user", user);

        l.info("loaded faucet", asset, amount);
        res.end();
      });
    } catch (e) {
      l.error("problem loading faucet", user.username, e.message);
      return res.status(500).send(e.message);
    }
  })
);

app.get(
  "/faucet",
  auth,
  ah(async (req, res) => {
    let { asset } = req.query;
    let faucet = await db.Account.findOne({
      where: {
        asset,
        user_id: null
      }
    });

    if (!faucet)
      faucet = {
        asset,
        balance: 0,
        ticker: "Unknown"
      };

    res.send(faucet);
  })
);
