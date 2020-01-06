const config = require("./config");
const Sequelize = require("sequelize");
const conf = config.dbOptions;

const db = new Sequelize(conf.database, conf.username, conf.password, {
  host: conf.host,
  dialect: conf.dialect,
  logging: false,
  dialectOptions: { multipleStatements: true }
});

db["User"] = require("./models/users.js")(db);
db["Payment"] = require("./models/payments.js")(db);

db["User"].hasMany(db["Payment"], {
  as: "payments",
  foreignKey: "user_id"
});

db["Payment"].belongsTo(db["User"], {
  as: "user",
  foreignKey: "user_id"
});

module.exports = db;
