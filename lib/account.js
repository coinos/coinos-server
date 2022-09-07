import axios from "axios";
import db from "$db";
import store from "$lib/store";

export default async (asset, user, transaction) => {
  const account = await db.Account.findOne({
    where: {
      user_id: user.id,
      asset,
      pubkey: null
    },
    lock: transaction.LOCK.UPDATE,
    transaction
  });

  if (account) return account;

  let params = {
    user_id: user.id,
    asset
  };
  let name = asset.substr(0, 6);
  let domain = "";
  let ticker = asset.substr(0, 3).toUpperCase();
  let precision = 8;

  if (store.assets[asset]) {
    ({ domain, ticker, precision, name } = store.assets[asset]);
  } else {
    const existing = await db.Account.findOne({
      where: {
        asset
      },
      order: [["id", "ASC"]],
      limit: 1,
      lock: transaction.LOCK.UPDATE,
      transaction
    });

    if (existing) {
      ({ domain, ticker, precision, name } = existing);
    }
  }

  params = { ...params, ...{ domain, ticker, precision, name } };
  params.balance = 0;
  params.pending = 0;
  return db.Account.create(params, { transaction });
};
