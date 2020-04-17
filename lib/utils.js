const { Op } = require("sequelize");

module.exports = {
  async getUser(username) {
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
          limit: 12
        },
        {
          model: db.Account,
          as: "accounts"
        }
      ],
      where:
      { [Op.or]: { username, id: username }}
    });
  }
};
