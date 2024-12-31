import config from "$config";
import countries from "$lib/countries";
import { db } from "$lib/db";
import { l, warn } from "$lib/logging";
import { fail, getUser } from "$lib/utils";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { got } from "got";
import { getPublicKey, nip19 } from "nostr-tools";
import { encrypt as nip49encrypt } from "nostr-tools/nip49";
import { authenticator } from "otplib";
import { v4 } from "uuid";

const valid = /^[\p{L}\p{N}]{2,24}$/u;
export default async (user, ip) => {
  let { password, pubkey, username } = user;
  l("registering", username);

  if (!username) fail("Username required");
  username = username.toLowerCase();
  if (!valid.test(username))
    fail("Usernames can only have letters and numbers");

  const id = v4();
  user.id = id;

  const exists = await getUser(username);
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
      const {
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

  if (!pubkey) {
    const sk = randomBytes(32);
    const pubkey = getPublicKey(sk);
    user.pubkey = pubkey;
    user.nsec = nip49encrypt(sk, password);
  }

  user.npub = nip19.npubEncode(pubkey);
  user.nwc = bytesToHex(randomBytes(32));

  const account = JSON.stringify({
    id,
    type: "ecash",
    name: "Spending",
  });

  db.multi()
    .set(getPublicKey(user.nwc), user.id)
    .set(`user:${id}`, JSON.stringify(user))
    .set(`user:${username}`, id)
    .set(`user:${pubkey}`, id)
    .set(`balance:${id}`, 0)
    .set(`account:${id}`, account)
    .set(`${pubkey}:follows:n`, 0)
    .set(`${pubkey}:followers:n`, 0)
    .set(`${pubkey}:pubkeys`, "[]")
    .lPush(`${id}:accounts`, id)
    .exec();

  l("new user", username);

  return user;
};
