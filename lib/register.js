import countries from "$lib/countries";
import config from "$config";
import { authenticator } from "otplib";
import bcrypt from "bcrypt";
import { l } from "$lib/logging";
import { v4 } from "uuid";
import redis from "$lib/redis";

export default async (user, ip, requireChallenge) => {
  let { password, username } = user;

  if (!username) throw new Error("Username required");

  username = username.replace(/ /g, "");
  let uuid = v4();
  user.uuid = uuid;

  let exists = await redis.get(`user:${username}`);
  if (exists) throw new Error(`Username ${username} taken`);

  if (password) {
    user.password = await bcrypt.hash(password, 1);
  }

  if (!config.ipxapi || ip.startsWith("127") || ip.startsWith("192")) {
    user.currency = "CAD";
  } else {
    let { countryCode } = await got(`https://ipxapi.com/api/ip?ip=${ip}`, {
      headers: { authorization: `Bearer ${config.ipxapi}` }
    }).json();

    user.currency = countries[countryCode] || "USD";
  }

  user.currencies = [...new Set([user.currency, "CAD", "USD"])];
  user.fiat = false;
  user.otpsecret = authenticator.generateSecret();

  let d = ip.split(".");
  ip = ((+d[0] * 256 + +d[1]) * 256 + +d[2]) * 256 + +d[3];
  if (Number.isInteger(ip)) {
    user.ip = ip;
  }

  await redis.set(`user:${user.uuid}`, user);
  await redis.set(`user:${user.username}`, user);
  l("new user", user.username);
  return user;
};
