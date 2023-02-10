import countries from "$lib/countries";
import config from "$config";
import { authenticator } from "otplib";
import bcrypt from "bcrypt";
import { l } from "$lib/logging";
import { v4 } from "uuid";
import { s, g } from "$lib/db";
import { got } from "got";

export default async (user, ip, requireChallenge) => {
  let { password, pubkey, username } = user;
  l("registering", username);

  if (!username) throw new Error("Username required");

  username = username.replace(/ /g, "");
  let id = v4();
  user.id = id;

  let exists = await g(`user:${username.toLowerCase()}`);
  if (exists) throw new Error(`Username ${username} taken`);

  if (password) {
    user.password = await bcrypt.hash(password, 1);
  }

  user.currency = "USD";
  if (config.ipxapi) {
    let countryCode = "US";

    try {
      let r = await got(`https://ipxapi.com/api/ip?ip=${ip}`, {
        headers: { authorization: `Bearer ${config.ipxapi}` }
      }).json();
      if (r.success) ({ countryCode } = r);
    } catch (e) {
      console.log(e);
    }

    user.currency = countries[countryCode];
  }

  user.currencies = [...new Set([user.currency, "CAD", "USD"])];
  user.fiat = false;
  user.otpsecret = authenticator.generateSecret();
  user.balance = 0;
  user.migrated = true;

  let d = ip.split(".");
  ip = ((+d[0] * 256 + +d[1]) * 256 + +d[2]) * 256 + +d[3];
  if (Number.isInteger(ip)) {
    user.ip = ip;
  }

  await s(`user:${id}`, user);
  await s(`user:${user.username.toLowerCase()}`, id);
  await s(`user:${pubkey}`, id);

  l("new user", user.username);
  return user;
};
