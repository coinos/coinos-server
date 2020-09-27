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

const { User, Account, Payment, Invoice, Key, Proposal } = db;

User.hasMany(Account, {
  as: "accounts",
  foreignKey: "user_id"
});

User.hasMany(Invoice, {
  as: "invoices",
  foreignKey: "user_id"
});

User.hasMany(Key, {
  as: "keys",
  foreignKey: "user_id"
});

User.hasMany(Payment, {
  as: "payments",
  foreignKey: "user_id"
});

User.belongsTo(Account, {
  as: "account",
  foreignKey: "account_id"
});

Invoice.belongsTo(Account, {
  as: "account",
  foreignKey: "account_id"
});

Account.belongsTo(User, {
  as: "user",
  foreignKey: "user_id"
});

Invoice.belongsTo(User, {
  as: "user",
  foreignKey: "user_id"
});

Key.belongsTo(User, {
  as: "user",
  foreignKey: "user_id"
});

Payment.belongsTo(Account, {
  as: "account",
  foreignKey: "account_id"
});

Payment.belongsTo(User, {
  as: "user",
  foreignKey: "user_id"
});

Proposal.belongsTo(User, {
  as: "user",
  foreignKey: "user_id"
});

Proposal.belongsTo(Account, {
  as: "acc1",
  foreignKey: "a1_id"
});

Proposal.belongsTo(Account, {
  as: "acc2",
  foreignKey: "a2_id"
});

db.Proposal = Proposal;
