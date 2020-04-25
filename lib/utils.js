const { Op } = require("sequelize");

getUser = async username => {
  return db.User.findOne({
    include: [
      {
        model: db.Payment,
        as: "payments",
        order: [["id", "DESC"]],
        where: {
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
      },
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
};

getUserById = async id => {
  return db.User.findOne({
    include: [
      {
        model: db.Payment,
        as: "payments",
        order: [["id", "DESC"]],
        where: {
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
      },
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
};
