const sequelize = require("sequelize");

app.get("/balances", async (req, res) => {
  const balances = {
    bitcoin: parseInt((await bc.getBalance()) * SATS),
    liquid: parseInt((await lq.getBalance()).bitcoin * SATS),
    channel: (await lna.channelBalance({})).balance,
    wallet: (await lna.walletBalance({})).total_balance,
    user: (await db['User'].findAll({
      attributes: [[sequelize.fn('sum', sequelize.col('balance')), 'total']],
      raw: true,
      order: sequelize.literal('total DESC')
    }))[0].total,
  };

  const { bitcoin, liquid, channel, user, wallet } = balances;
  balances.ratio = ((parseInt(bitcoin) + parseInt(liquid) + parseInt(channel) + parseInt(wallet))/parseInt(user)).toFixed(2);
  res.send(balances);
});
