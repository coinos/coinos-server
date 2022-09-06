import db from "$db";
import sequelize from "@sequelize/core";
const { Op } = sequelize;

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
