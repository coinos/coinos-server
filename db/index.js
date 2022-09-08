import Sequelize from "@sequelize/core";

import db from "$db/db";
import dbOptions from "$config/knexfile";

db.authenticate().catch(err => {
  console.debug("Error connecting to database: " + err.message);
});

import "./models/accounts";
import "./models/codes";
import "./models/deposits";
import "./models/invoices";
import "./models/keys";
import "./models/payments";
import "./models/orders";
import "./models/users";
import "./models/withdrawals";

import "./models/referrals";
import "./models/waiting_list";

const { User, Account, Payment, Invoice, Key, Order, Referral } = db;

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

User.hasMany(Order, {
  as: "orders",
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

Payment.belongsTo(Invoice, {
  as: "invoice",
  foreignKey: "invoice_id"
});

Order.belongsTo(User, {
  as: "user",
  foreignKey: "user_id"
});

Order.belongsTo(Account, {
  as: "acc1",
  foreignKey: "a1_id"
});

Order.belongsTo(Account, {
  as: "acc2",
  foreignKey: "a2_id"
});

User.hasMany(Referral, {
  as: "referral_codes",
  foreignKey: "sponsor_id"
});
User.hasMany(Referral, {
  as: "sponsors",
  foreignKey: "user_id"
});

Referral.belongsTo(User, {
  as: "sponsor",
  foreignKey: "sponsor_id"
});
Referral.belongsTo(User, {
  as: "user",
  foreignKey: "user_id"
});

Payment.belongsTo(Payment, {
  as: "fee_payment",
  foreignKey: "fee_payment_id"
});

db.Order = Order;

export default db;
