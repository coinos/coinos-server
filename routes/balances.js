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

  const info = {
    lnd: await lna.getInfo({}),
    bitcoind: await bc.getNetworkInfo(),
    elementsd: await lq.getNetworkInfo(),
    accounts,
    assets,
    bitcoin: parseInt((await bc.getBalance()) * SATS),
    liquid: parseInt(assets.bitcoin * SATS),
    lnchannel: parseInt((await lna.channelBalance({})).balance),
    lnwallet: parseInt((await lna.walletBalance({})).total_balance),
  };

  const { bitcoin, liquid, lnchannel, user, lnwallet } = info;

  info.total =
    parseInt(bitcoin) +
    parseInt(liquid) +
    parseInt(lnchannel) +
    parseInt(lnwallet);

  info.ratio = (info.total / parseInt(user)).toFixed(2);

  res.send(info);
});
