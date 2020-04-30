const sequelize = require("sequelize");
const { Op } = sequelize;

getUser = async (username, transaction) => {
  let params = {
    include: [
      {
        model: db.Account,
        as: "accounts"
      },
      {
        model: db.Account,
        as: "account"
      }
    ],
    where: { username }
  };

  if (transaction) {
    params.lock = transaction.LOCK.UPDATE;
    params.transaction = transaction;
  }

  let user = await db.User.findOne(params);

  user = user.get({ plain: true });

  params = {
    order: [["id", "DESC"]],
    where: {
      user_id: user.id,
      account_id: user.account_id,
      [Op.or]: {
        received: true,
        amount: {
          [Op.lt]: 0
        }
      }
    },
    limit: 12,
    include: {
      model: db.Account,
      as: "account"
    }
  };

  if (transaction) {
    params.lock = transaction.LOCK.UPDATE;
    params.transaction = transaction;
  }

  user.payments = await db.Payment.findAll(params);

  return user;
};

getUserById = async (id, transaction) => {
  let params = {
    include: [
      {
        model: db.Account,
        as: "accounts"
      },
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

  user = user.get({ plain: true });

  params = {
    order: [["id", "DESC"]],
    where: {
      user_id: user.id,
      account_id: user.account_id,
      [Op.or]: {
        received: true,
        amount: {
          [Op.lt]: 0
        }
      }
    },
    limit: 12,
    include: {
      model: db.Account,
      as: "account"
    }
  };

  if (transaction) {
    params.lock = transaction.LOCK.UPDATE;
    params.transaction = transaction;
  }

  user.payments = await db.Payment.findAll(params);

  return user;
};
