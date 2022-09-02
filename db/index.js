import Sequelize from 'sequelize';
import dbOptions from './../config/knexfile.js';

db = new Sequelize(
  dbOptions.connection.database,
  dbOptions.connection.user,
  dbOptions.connection.password,
  {
    host: dbOptions.connection.host,
    dialect: "mariadb",
    logging: false,
    dialectOptions: { multipleStatements: true, timezone: "Etc/GMT+7" },
  }
);

db.authenticate().catch((err) => {
  console.debug("Error connecting to database: " + err.message);
  console.log(dbOptions.connection.database + "." + dbOptions.connection.user);
});

knex = require("knex")(dbOptions);

import './models/accounts.js';
import './models/codes.js';
import './models/deposits.js';
import './models/invoices.js';
import './models/keys.js';
import './models/payments.js';
import './models/orders.js';
import './models/users.js';
import './models/withdrawals.js';

// Require models in order (to enable FK relationship specs in models)

// require("./normalized/users.js");
// require("./normalized/user_keys.js");
// require("./normalized/user_preferences.js");

import './models/referrals.js';

import './models/waiting_list.js';

// require("./normalized/subscriptions.js");
// require("./normalized/user_subscriptions.js");

// require("./normalized/assets.js");
// require("./normalized/codes.js");
// require("./normalized/currencies.js");
// require("./normalized/networks.js");
// require("./normalized/institutions.js");

// require("./normalized/accounts.js");
// require("./normalized/non_custodial_accounts.js");
// require("./normalized/deposits.js");
// require("./normalized/withdrawals.js");
// require("./normalized/payments.js");

// ** Need to add ? ***
// require("./normalized/orders.js");
// require("./normalized/invoices.js");

const { User, Account, Payment, Invoice, Key, Order, Referral } = db;

// move relationships to specfic models
User.hasMany(Account, {
  as: "accounts",
  foreignKey: "user_id",
});

User.hasMany(Invoice, {
  as: "invoices",
  foreignKey: "user_id",
});

User.hasMany(Key, {
  as: "keys",
  foreignKey: "user_id",
});

User.hasMany(Order, {
  as: "orders",
  foreignKey: "user_id",
});

User.hasMany(Payment, {
  as: "payments",
  foreignKey: "user_id",
});

User.belongsTo(Account, {
  as: "account",
  foreignKey: "account_id",
});

Invoice.belongsTo(Account, {
  as: "account",
  foreignKey: "account_id",
});

Account.belongsTo(User, {
  as: "user",
  foreignKey: "user_id",
});

Invoice.belongsTo(User, {
  as: "user",
  foreignKey: "user_id",
});

Key.belongsTo(User, {
  as: "user",
  foreignKey: "user_id",
});

Payment.belongsTo(Account, {
  as: "account",
  foreignKey: "account_id",
});

Payment.belongsTo(User, {
  as: "user",
  foreignKey: "user_id",
});

Payment.belongsTo(Invoice, {
  as: "invoice",
  foreignKey: "invoice_id",
});

Order.belongsTo(User, {
  as: "user",
  foreignKey: "user_id",
});

Order.belongsTo(Account, {
  as: "acc1",
  foreignKey: "a1_id",
});

Order.belongsTo(Account, {
  as: "acc2",
  foreignKey: "a2_id",
});

User.hasMany(Referral, {
  as: "referral_codes",
  foreignKey: "sponsor_id",
});
User.hasMany(Referral, {
  as: "sponsors",
  foreignKey: "user_id",
});

Referral.belongsTo(User, {
  as: "sponsor",
  foreignKey: "sponsor_id",
});
Referral.belongsTo(User, {
  as: "user",
  foreignKey: "user_id",
});

Payment.belongsTo(Payment, {
  as: "fee_payment",
  foreignKey: "fee_payment_id"
});

db.Order = Order;
