const sequelize = require("sequelize");
const { Op } = sequelize;

app.get("/balances", async (req, res) => {
  const assets = await lq.getBalance();
  const accounts = await db.Account.findAll({
    attributes: [
      "asset",
      [sequelize.fn("sum", sequelize.col("balance")), "total"]
    ],
    group: ["asset"],
    where: {
      asset: {
        [Op.ne]: config.liquid.btcasset
      }
    }
  });

  const balances = {
    accounts,
    assets,
    bitcoin: parseInt((await bc.getBalance()) * SATS),
    liquid: parseInt(assets.bitcoin * SATS),
    lnchannel: parseInt((await lna.channelBalance({})).balance),
    lnwallet: parseInt((await lna.walletBalance({})).total_balance),
    user: parseInt((await db["User"].findAll({
      attributes: [[sequelize.fn("sum", sequelize.col("balance")), "total"]],
      raw: true,
      order: sequelize.literal("total DESC")
    }))[0].total)
  };

  const { bitcoin, liquid, lnchannel, user, lnwallet } = balances;
  balances.ratio = (
    (parseInt(bitcoin) +
      parseInt(liquid) +
      parseInt(lnchannel) +
      parseInt(lnwallet)) /
    parseInt(user)
  ).toFixed(2);
  res.send(balances);
});
