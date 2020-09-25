const sequelize = require("sequelize");
const { Op } = sequelize;

app.get("/info", ah(async (req, res, next) => {
  const { clientVersion } = config;

  const info = {
    fx: app.get("fx"),
    nodes: networks,
    clientVersion,
  };

  res.send(info);
}));

app.get("/balances", ah(async (req, res, next) => {
  const accounts = await db.Account.findAll({
    attributes: [
      "asset",
      "pubkey",
      [sequelize.fn("sum", sequelize.col("balance")), "total"]
    ],
    group: ["asset", "pubkey"],
  });

  let lnchannel; 
  let lnwallet;
  let lninfo;

  if (config.lna) {
    if (config.lna.clightning) {
      const funds = await lna.listfunds();
      lninfo = await lna.getinfo();
      lnchannel = parseInt(funds.channels.reduce((a, b) => a + b.channel_sat, 0));
      lnwallet = parseInt(funds.outputs.reduce((a, b) => a + b.value, 0));
    } else {
      lninfo = await lna.getInfo({});
      lnchannel = parseInt((await lna.channelBalance({})).balance);
      lnwallet = parseInt((await lna.walletBalance({})).total_balance);
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
    lnwallet,
  };

  info.total =
    parseInt(bitcoin) +
    parseInt(liquid) +
    parseInt(lnchannel) +
    parseInt(lnwallet);

  res.send(info);
}));
