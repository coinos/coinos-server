import countries from "$lib/countries";
import config from "$config";
import { authenticator } from "otplib";
import bcrypt from "bcrypt";
import { l, warn } from "$lib/logging";
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
  if (config.ipregistry) {
    try {
      let {
        location: {
          country: { code }
        }
      } = await got(
        `https://api.ipregistry.co/${ip}?key=${config.ipregistry}&fields=location.country.code`
      ).json();

      user.currency = countries[code];
    } catch (e) {
      warn("unable to detect country from IP", username);
    }
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
