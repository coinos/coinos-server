import sequelize from '@sequelize/core';
const { Op } = sequelize;

export const getUser = async (username, transaction) => {
  let params = {
    include: [
      {
        model: db.Account,
        as: "account",
      },
    ],
    where: {
      username: { [Op.or]: [username, username.replace(/ /g, "")] },
    },
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
        as: "account",
      },
    ],
    where: { id },
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
