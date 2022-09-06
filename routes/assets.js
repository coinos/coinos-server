import { emit } from "$lib/sockets";
import store from "$lib/store";
import db from "$db";
import config from "$config";
import app from "$app";
import { auth } from "$lib/passport";
import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import { err, l } from "$lib/logging";
import lq from "$lib/liquid";
import { SATS } from "$lib/utils";

let fetchAssets;
(fetchAssets = async () => {
  try {
    const { data } = await axios.get("https://assets.blockstream.info/");

    store.assets = data;
  } catch (e) {
    var liquid_assets = require("./../assets.json");
    if (liquid_assets) {
      app.set("assets", liquid_assets);
      console.debug("using static assets..." + e.message);
    } else {
      err("error fetching assets", e.message);
      res.code(500).send("error fetching assets");
    }
  }

  setTimeout(fetchAssets, 7200000);
})();

app.get("/assets", async (req, res) => {
  if (store.assets) {
    const accounts = await db.Account.findAll({
      // group: ["asset"]
    });
    Object.keys(store.assets).map(a => {
      store.assets[a].registered = true;
      if (!store.assets[a].asset)
        store.assets[a].asset = store.assets[a].asset_id;
      if (
        (store.assets[a].ticker === "BTC" &&
          store.assets[a].asset !== config.liquid.btcasset) ||
        (store.assets[a].ticker === "EUR" &&
          store.assets[a].asset !== config.liquid.eurasset) ||
        (store.assets[a].ticker === "CAD" &&
          store.assets[a].asset !== config.liquid.cadasset) ||
        (store.assets[a].ticker === "USDt" &&
          store.assets[a].asset !== config.liquid.usdtasset)
      )
        delete store.assets[a];
    });
    accounts.map(({ asset, name, domain, ticker, precision }) => {
      if (!store.assets[asset])
        store.assets[asset] = {
          asset,
          name,
          domain,
          ticker,
          precision
        };
    });

    res.send(store.assets);
  } else {
    console.log("error getting blockstream assets");
    res.code(500).send("Problem fetching blockstream asset registry data");
  }
});

app.post("/assets", auth, async (req, res) => {
  try {
    const sha256 = crypto.createHash("sha256");
    const { id: user_id } = req.user;
    const blind = false;

    if (!user_id) throw new Error("unauthorized");

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

    let contract = {
      entity: { domain },
      issuer_pubkey,
      name,
      precision,
      version
    };

    if (filename) contract.file = filename;
    if (ticker) contract.ticker = ticker;

    contract = Object.keys(contract)
      .sort()
      .reduce((r, k) => ((r[k] = contract[k]), r), {});

    l(
      "attempting issuance",
      req.user.username,
      contract,
      "address",
      address,
      "pubkey",
      pubkey
    );

    sha256.update(JSON.stringify(contract));
    const hash = sha256.digest("hex");
    const contract_hash = hash
      .match(/[a-f0-9]{2}/g)
      .reverse()
      .join("");
    const rawtx = await lq.createRawTransaction([], [{ data: "00" }]);
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
      l(asset_amount, token_amount, params);
      throw new Error(e.message);
    }

    const { asset, hex, token } = ria[0];
    const brt = await lq.blindRawTransaction(hex, true, [], false);
    const srt = await lq.signRawTransactionWithWallet(brt);
    const allowed = (await lq.testMempoolAccept([srt.hex]))[0].allowed;
    if (!allowed) throw new Error("issuance rejected by mempool", srt.hex);
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
        order: [["balance", "DESC"]],
        transaction
      });

      let { user } = account;

      if (Math.round(funded.fee * SATS) > account.balance) {
        err(
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
          pending: address ? 0 : Math.round(params.asset_amount * SATS)
        },
        { transaction }
      );

      emit(user.username, "account", account);
      l(
        "issued asset",
        user.username,
        params.asset_amount,
        ticker,
        name,
        account.id
      );

      if (!address) {
        const asset_payment = await db.Payment.create(
          {
            account_id: account.id,
            user_id,
            hash: txid,
            amount: Math.round(params.asset_amount * SATS),
            received: true,
            confirmed: false,
            address: asset_address,
            network: "liquid"
          },
          { transaction }
        );
        emit(user.username, "payment", asset_payment);

        store.issuances[txid] = {
          user_id,
          asset,
          asset_amount: params.asset_amount,
          asset_payment_id: asset_payment.id
        };
      }

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
            pending: address ? 0 : Math.round(token_amount * SATS)
          },
          { transaction }
        );
        emit(user.username, "account", account);

        if (!address) {
          const token_payment = await db.Payment.create(
            {
              account_id: account.id,
              user_id,
              hash: txid,
              amount: Math.round(token_amount * SATS),
              received: true,
              confirmed: false,
              address: token_address,
              network: "liquid"
            },
            { transaction }
          );
          emit(user.username, "payment", token_payment);

          store.issuances[txid].token = token;
          store.issuances[txid].token_amount = token_amount;
          store.issuances[txid].token_payment_id = token_payment.id;
        }
      }
    });

    res.send(store.issuances[txid] ? store.issuances[txid] : { asset });
  } catch (e) {
    err("asset issuance failed", e.message, e.stack);
    res.code(500).send(e.message);
  }
});

app.post("/assets/register", auth, async (req, res) => {
  const { asset } = req.body;
  const account = await db.Account.findOne({
    where: {
      user_id: req.user.id,
      asset
    }
  });

  l("registering", asset, account.contract);

  try {
    const { data: result } = await axios.post(
      "https://assets.blockstream.info/",
      {
        asset_id: asset,
        contract: account.contract
      }
    );
    l("register asset result", req.user.username, result);
    res.send(result);
  } catch (e) {
    err("asset registration failed", e.message);
    res.code(500).send(e.message);
  }
});

app.post("/loadFaucet", auth, async (req, res) => {
  return res.code(500).send("Faucet feature temporarily disabled");

  const { user } = req;
  let { asset, amount } = req.body;
  amount = parseInt(amount);

  try {
    if (amount <= 0) throw new Error("Amount to load cannot be negative");

    await db.transaction(async transaction => {
      let account = await getAccount(config.liquid.btcasset, user, transaction);

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

        const assets = assets;

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
        rate: store.rates[user.currency],
        currency: user.currency,
        confirmed: true,
        hash: `Loaded Faucet - ${a2.ticker}`,
        network: "COINOS"
      };

      let payment = await db.Payment.create(params, { transaction });

      payment = payment.get({ plain: true });
      payment.account = account.get({ plain: true });

      l("sent internal", user.username, -payment.amount);

      emit(user.username, "payment", payment);
      emit(user.username, "account", account);
      emit(user.username, "user", user);

      l("loaded faucet", asset, amount);
      res.send({});
    });
  } catch (e) {
    err("problem loading faucet", user.username, e.message);
    return res.code(500).send(e.message);
  }
});

app.get("/faucet", auth, async (req, res) => {
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
});
