const authenticator = require("otplib").authenticator;
const axios = require("axios");
const bcrypt = require("bcrypt");

register = async (user, ip, requireChallenge) => {
  if (!(user && user.username)) throw new Error("Username required");

  let exists = await db.User.count({ where: { username: user.username } });
  if (exists) throw new Error(`Username ${user.username} taken`);

  if (user.password && user.password === user.confirm) {
    user.password = await bcrypt.hash(user.password, 1);
  }

  if (config.bitcoin) {
    if (config.bitcoin.walletpass)
      await bc.walletPassphrase(config.bitcoin.walletpass, 300);

    user.address = await bc.getNewAddress("", "bech32");
    addresses[user.address] = user.username;
  }

  if (config.liquid) {
    if (config.liquid.walletpass)
      await lq.walletPassphrase(config.liquid.walletpass, 300);

    user.confidential = await lq.getNewAddress();
    user.liquid = (await lq.getAddressInfo(user.confidential)).unconfidential;
    addresses[user.liquid] = user.username;
  }

  if (
    requireChallenge &&
    (!challenge[ip] ||
      user.response.toLowerCase() !== challenge[ip].toLowerCase())
  ) {
    l.info("failed challenge", ip, user.response, challenge[ip]);
    throw new Error("Failed challenge");
  }

  delete challenge[ip];

  let countries = {
    CA: "CAD",
    US: "USD",
    JP: "JPY",
    CN: "CNY",
    AU: "AUD",
    GB: "GBP",
  };

  if (!config.ipstack || ip.startsWith("127") || ip.startsWith("192"))
    user.currency = "CAD";
  else {
    let info = await axios.get(
      `http://api.ipstack.com/${ip}?access_key=${config.ipstack}`
    );
    user.currency = countries[info.data.country_code] || "USD";
  }

  user.currencies = [...new Set([user.currency, "CAD", "USD"])];
  user.fiat = false;
  user.otpsecret = authenticator.generateSecret();

  user = await db.User.create(user);

  let account = await db.Account.create({
    user_id: user.id,
    asset: config.liquid.btcasset,
    balance: 0,
    pending: 0,
    name: "Bitcoin",
    ticker: "BTC",
    precision: 8,
  });

  user.accounts = [account];

  const d = ip.split(".");
  const numericIp = ((+d[0] * 256 + +d[1]) * 256 + +d[2]) * 256 + +d[3];
  if (Number.isInteger(numericIp)) {
    user.ip = numericIp;
    const ipExists = await db.User.findOne({ where: { ip: numericIp } });
  }

  user.account_id = account.id;
  await user.save();
  l.info("new user", user.username, ip);
  return user;
};
