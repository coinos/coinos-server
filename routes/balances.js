const sequelize = require("sequelize");
const { Op } = sequelize;

app.get("/info", async (req, res) => {
  const assets = await lq.getBalance();
  const accounts = await db.Account.findAll({
    attributes: [
      "asset",
      [sequelize.fn("sum", sequelize.col("balance")), "total"]
    ],
    group: ["asset"],
  });

  let lnchannel; 
  let lnwallet;
  let lninfo;

  if (config.lna.clightning) {
    lninfo = await lna.getinfo();
    const funds = await lna.listfunds();
    lnchannel = parseInt(funds.channels.reduce((a, b) => a + b.channel_sat, 0));
    lnwallet = parseInt(funds.outputs.reduce((a, b) => a + b.value, 0));
  } else {
    lninfo = await lna.getInfo({});
    lnchannel = parseInt((await lna.channelBalance({})).balance);
    lnwallet = parseInt((await lna.walletBalance({})).total_balance);
  } 

  const info = {
    bitcoind: await bc.getNetworkInfo(),
    elementsd: await lq.getNetworkInfo(),
    accounts,
    assets,
    bitcoin: parseInt((await bc.getBalance()) * SATS),
    liquid: parseInt(assets.bitcoin * SATS),
    lnchannel,
    lnwallet,
  };

  const { bitcoin, liquid, user } = info;

  info.total =
    parseInt(bitcoin) +
    parseInt(liquid) +
    parseInt(lnchannel) +
    parseInt(lnwallet);

  info.ratio = (info.total / parseInt(user)).toFixed(2);

  res.send(info);
});
