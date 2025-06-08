import config from "$config";
import countries from "$lib/countries";
import { db, s } from "$lib/db";
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
  username = username.toLowerCase().replace(/\s/g, "");
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

  let sk;
  if (!pubkey) {
    sk = randomBytes(32);
    pubkey = getPublicKey(sk);
    user.pubkey = pubkey;
    user.nsec = nip49encrypt(sk, password);
  }

  user.npub = nip19.npubEncode(pubkey);

  const account = JSON.stringify({
    id,
    type: "ecash",
    name: "Spending",
  });

  const bytes = randomBytes(32);
  const secret = bytesToHex(bytes);
  const app = {
    uid: id,
    secret,
    pubkey: getPublicKey(bytes),
    max_amount: 1000000,
    budget_renewal: "weekly",
    name: username,
    created: Date.now(),
  };

  await s(`app:${app.pubkey}`, app);
  await db.sAdd(`${id}:apps`, app.pubkey);

  db.multi()
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
  if (sk) user.sk = bytesToHex(sk);

  return user;
};
