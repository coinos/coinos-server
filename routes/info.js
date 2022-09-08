import app from "$app";
import db from "$db";
import config from "$config";
import store from "$lib/store";

import bc from "$lib/bitcoin";
import lq from "$lib/liquid";
import lnd from "$lib/lnd";

import { getChannelBalance, getChainBalance } from "lightning";
import sequelize from "@sequelize/core";
import { SATS } from "$lib/utils";

const { Op } = sequelize;

/**
 * @api {get} /info Request server information
 * @apiName GetInfo
 * @apiGroup Info
 *
 * @apiSuccess {Object} fx Exchange rates relative to USD - fx.CUR is the value of one CUR in USD.
 * @apiSuccess {String[]} networks Array of supported networks; possible values are "bitcoin", "liquid" and "lightning".
 * @apiSuccess {String} clientVersion the current git commit of the ui
 */
app.get("/info", async (req, res, next) => {
  const { clientVersion } = config;

  const info = {
    fx: store.fx,
    nodes: store.networks,
    clientVersion
  };

  res.send(info);
});

app.get("/balances", async (req, res, next) => {
  try {
  const accounts = await db.Account.findAll({
    attributes: [
      "asset",
      "pubkey",
      [sequelize.fn("sum", sequelize.col("balance")), "total"]
    ],
    group: ["asset", "pubkey"]
  });

  let lnchannel;
  let lnwallet;

  if (config.lna) {
    if (config.lna.clightning) {
      const funds = await lna.listfunds();
      lnchannel = parseInt(
        funds.channels.reduce((a, b) => a + b.channel_sat, 0)
      );
      lnwallet = parseInt(funds.outputs.reduce((a, b) => a + b.value, 0));
    } else {
      lnchannel = parseInt(await getChannelBalance({ lnd }).channel_balance);
      lnwallet = parseInt(await getChainBalance({ lnd }).chain_balance);
    }
  }

  let bitcoin, bitcoind;
  if (config.bitcoin) {
    bitcoin = parseInt((await bc.getBalance()) * SATS);
    bitcoind = await bc.getNetworkInfo();
  }

  let assets, liquid, elementsd;
  if (config.liquid) {
    assets = await lq.getBalance();
    liquid = parseInt(assets.bitcoin * SATS);
    elementsd = await lq.getNetworkInfo();
  }

  const info = {
    bitcoind,
    elementsd,
    accounts,
    assets,
    bitcoin,
    liquid,
    lnchannel,
    lnwallet
  };

  info.total =
    parseInt(bitcoin) +
    parseInt(liquid) +
    parseInt(lnchannel) +
    parseInt(lnwallet);

  res.send(info);
  } catch(e) {
    console.log("problem getting balances", e)
  } 
});
