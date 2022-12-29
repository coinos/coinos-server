import store from "$lib/store";
import redis from "$lib/redis";
import config from "$config";
import db from "$db";
import sequelize from "@sequelize/core";
import { fromBase58 } from "bip32";
import { payments as bcPayments, networks as bcNetworks } from "bitcoinjs-lib";
import { payments as lqPayments, networks as lqNetworks } from "liquidjs-lib";
import lnd from "$lib/lnd";
import ln from "$lib/ln";
import { coinos } from "$lib/nostr";

const { Op } = sequelize;

export const sleep = n => new Promise(r => setTimeout(r, n));
export const wait = async (f, s = 300, n = 1000) => {
  let i = 0;
  while (!(await f()) && i < s) (await sleep(n)) && i++;
  if (i >= s) throw new Error("timeout");
  return f();
};

export const requirePin = async ({ body, user }) => {
  if (!user || (user.pin && user.pin !== body.pin))
    throw new Error("Invalid pin");
};

export const getUser = async (username, transaction) => {
  let params = {
    include: [
      {
        model: db.Account,
        as: "account"
      }
    ],
    where: {
      username: { [Op.or]: [username, username.replace(/ /g, "")] }
    }
  };

  if (transaction) {
    params.lock = transaction.LOCK.UPDATE;
    params.transaction = transaction;
  }

  let user = await db.User.findOne(params);
  if (!user) throw new Error(`User ${username} not found`);

  user.haspin = !!user.pin;

  let { pubkey } = user;

  if (pubkey) {
    store.fetching[pubkey] = true;
    store.timeouts[pubkey] = setTimeout(
      () => (store.fetching[pubkey] = false),
      500
    );

    await wait(() => !!coinos, 100, 10);
    coinos.subscribe(`${pubkey}:follows`, {
      limit: 1,
      kinds: [3],
      authors: [pubkey]
    });

    await wait(() => !store.fetching[pubkey], 100, 10);
  }

  user.follows = JSON.parse(await redis.get(`${pubkey}:follows`)) || [];
  user.followers = await redis.sMembers(`${pubkey}:followers`);

  return user;
};

export const getUserById = async (id, transaction) => {
  let params = {
    include: [
      {
        model: db.Account,
        as: "account"
      }
    ],
    where: { id }
  };

  if (transaction) {
    params.lock = transaction.LOCK.UPDATE;
    params.transaction = transaction;
  }

  let user = await db.User.findOne(params);
  if (!user) throw new Error("User not found");

  return user;
};

export const prod = process.env.NODE_ENV === "production";
export const fail = msg => {
  throw new Error(msg);
};

export const SATS = 100000000;
export const toSats = n => Math.round(n * SATS);

export const getBlockHeight = message => {
  let buffer = Buffer.from(message, "hex");
  if (buffer.length < 80) throw new Error("Buffer too small (< 80 bytes)");

  let offset = 0;
  const readSlice = n => {
    offset += n;
    return buffer.slice(offset - n, offset);
  };

  const readUInt32 = () => {
    const i = buffer.readUInt32LE(offset);
    offset += 4;
    return i;
  };

  const readUInt8 = () => {
    const i = buffer.readUInt8(offset);
    offset += 1;
    return i;
  };

  const readVarInt = () => {
    const vi = varuint.decode(buffer, offset);
    offset += varuint.decode.bytes;
    return vi;
  };

  readUInt32();
  readSlice(32);
  readSlice(32);
  readUInt32();
  return readUInt32();
};

export const deriveAddress = async (account, type) => {
  let { index, pubkey, path, network } = account;
  let n = { bitcoin: bcNetworks, liquid: lqNetworks }[network][
    prod ? "bitcoin" : "regtest"
  ];
  let p = { bitcoin: bcPayments, liquid: lqPayments }[network];
  let root = fromBase58(pubkey, n);
  let parts = path.split("/");
  let hd = root.derive(parseInt(parts[parts.length - 1]));

  type = {
    bech32: "p2wpkh",
    "p2sh-segwit": "p2sh",
    legacy: "p2pkh"
  }[type];

  console.log("TYPE", type);

  let r;
  if (type !== "p2sh") {
    r = p[type]({
      pubkey: hd.publicKey,
      network: n
    });
  } else {
    r = p[type]({
      redeem: p.p2wpkh({
        pubkey: hd.publicKey,
        network: n
      }),
      network: n
    });
  }

  index++;
  account.index = index;
  account.address = r.address;
  await account.save();

  return r;
};

export const bip21 = ({ address, amount, memo, tip, network }, { asset }) => {
  if (network === "liquid") network = "liquidnetwork";

  let url = amount || memo ? `${network}:${address}?` : address;
  if (amount)
    url += `amount=${((amount + tip) / SATS).toFixed(8)}${memo ? "&" : ""}`;
  if (memo) url += `message=${memo}`;

  if (network === "liquidnetwork" && amount) {
    url += `&asset=${asset}`;
  }

  return url;
};

export const derivePayRequest = async ({ amount, memo, tip }) => {
  if (!tip) tip = 0;
  let value = amount + tip;

  if (!memo) memo = "coinos";
  return (
    await ln.invoice(value ? `${value}sat` : "any", new Date(), memo, 360)
  ).bolt11;
};

export const uniq = (a, k) => [...new Map(a.map(x => [k(x), x])).values()];
