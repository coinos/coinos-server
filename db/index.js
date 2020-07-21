const Sequelize = require("sequelize");
const conf = config.dbOptions;

db = new Sequelize(conf.database, conf.username, conf.password, {
  host: conf.host,
  dialect: conf.dialect,
  logging: false,
  dialectOptions: conf.dialectOptions
});

require("./models/accounts.js");
require("./models/codes.js");
require("./models/invoices.js");
require("./models/keys.js");
require("./models/payments.js");
require("./models/proposals.js");
require("./models/users.js");

db["User"].hasMany(db["Account"], {
  as: "accounts",
  foreignKey: "user_id"
});

db["User"].hasMany(db["Invoice"], {
  as: "invoices",
  foreignKey: "user_id"
});

db["User"].hasMany(db["Key"], {
  as: "keys",
  foreignKey: "user_id"
});

db["User"].hasMany(db["Payment"], {
  as: "payments",
  foreignKey: "user_id"
});

db["User"].belongsTo(db["Account"], {
  as: "account",
  foreignKey: "account_id"
});

db["Account"].belongsTo(db["User"], {
  as: "user",
  foreignKey: "user_id"
});

db["Invoice"].belongsTo(db["User"], {
  as: "user",
  foreignKey: "user_id"
});

db["Key"].belongsTo(db["User"], {
  as: "user",
  foreignKey: "user_id"
});

db["Payment"].belongsTo(db["Account"], {
  as: "account",
  foreignKey: "account_id"
});

db["Payment"].belongsTo(db["User"], {
  as: "user",
  foreignKey: "user_id"
});

db["Proposal"].belongsTo(db["User"], {
  as: "user",
  foreignKey: "user_id"
});
