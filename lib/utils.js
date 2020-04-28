const sequelize = require("sequelize");
const { Op } = sequelize;

getUser = async username => {
  let user = await db.User.findOne({
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
  });

  user = user.get({ plain: true });

  user.payments = await db.Payment.findAll({
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
    limit: 12
  });

  return user;
};

getUserById = async id => {
  let user = await db.User.findOne({
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
  });

  user = user.get({ plain: true });

  user.payments = await db.Payment.findAll({
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
    limit: 12
  });

  return user;
};
