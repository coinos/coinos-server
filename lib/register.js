import countries from "$lib/countries";
import config from "$config";
import { authenticator } from "otplib";
import db from "$db";
import axios from "axios";
import bcrypt from "bcrypt";
import { l } from "$lib/logging";

export default async (user, ip, requireChallenge) => {
  if (!(user && user.username)) throw new Error("Username required");
  user.username = user.username.replace(/ /g, "");

  let exists = await db.User.count({ where: { username: user.username } });
  if (exists) throw new Error(`Username ${user.username} taken`);

  if (user.password) {
    user.password = await bcrypt.hash(user.password, 1);
  }

  if (!config.ipxapi || ip.startsWith("127") || ip.startsWith("192")) {
    user.currency = "CAD";
  } else {
    let { data } = await axios.get(`https://ipxapi.com/api/ip?ip=${ip}`, {
      headers: { authorization: `Bearer ${config.ipxapi}` }
    });

    user.currency = countries[data.countryCode] || "USD";
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
    precision: 8
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
  l("new user", user.username, ip);
  return user;
};
