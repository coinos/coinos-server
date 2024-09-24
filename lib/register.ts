import { got } from "got";
import { authenticator } from "otplib";
import { v4 } from "uuid";

import config from "$config";
import countries from "$lib/countries";
import { db } from "$lib/db";
import { l, warn } from "$lib/logging";
import { fail, getUser } from "$lib/utils";

let valid = /^[\p{L}\p{N}]{2,24}$/u;
export default async (user, ip) => {
  let { password, pubkey, username } = user;
  l("registering", username);

  if (!username) fail("Username required");
  username = username.toLowerCase();
  if (!valid.test(username))
    fail("Usernames can only have letters and numbers");

  let id = v4();
  user.id = id;

  let exists = await getUser(username);
  if (exists) fail(`Username ${username} taken`);

  if (password) {
    user.password = await Bun.password.hash(password, {
      algorithm: "bcrypt",
      cost: 4,
    });
  }

  user.currency = "USD";
  if (config.ipregistry) {
    try {
      let {
        location: { country: { code } },
      }: any = await got(
        `https://api.ipregistry.co/${ip}?key=${config.ipregistry}&fields=location.country.code`,
      ).json();

      user.currency = countries[code];
    } catch (e) {
      warn("unable to detect country from IP", username);
    }
  }

  user.currencies = [...new Set([user.currency, "CAD", "USD"])];
  user.fiat = false;
  user.otpsecret = authenticator.generateSecret();
  user.migrated = true;
  user.locktime = 300;

  let account = JSON.stringify({
    id,
    type: "ecash",
    name: "Spending",
  });

  db.multi()
    .set(`user:${id}`, JSON.stringify(user))
    .set(`user:${username}`, id)
    .set(`user:${pubkey}`, id)
    .set(`balance:${id}`, 0)
    .set(`account:${id}`, account)
    .lPush(`${id}:accounts`, id)
    .exec();

  l("new user", username);

  return user;
};
