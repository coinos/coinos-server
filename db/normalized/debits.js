exports.up = function(knex) {
  return knex.schema.createTable('debits', function(t) {
      t.increments('id').unsigned().primary();

      t.enu('type', ['withdrawal', 'order', 'transfer', 'invoice', 'exchange'])

      t.int('account_id').notNull();
      t.foreign('account_id').references('accounts.id');

      t.double('amount');

      t.enu('type', ['withdrawal', 'transfer', 'order', 'invoice'])
      t.enu('status', ['pending', 'completed', 'reversed', 'cancelled'])

      t.timestamps();
  })
};

exports.down = function(knex) {
return knex.schema.dropTable('debits');
};

// Changes: 
//
// Should these be tracked as transactions ? 
// SAT -> SAT
// tracking various exchange variations (outside of external networks ?)
//
// Is user / account / amount info redundant ?
// + transaction_type: deposit / withdrawal / transfer / exchange ?
//
// add transfers table ? (for internal transfers only ?)
// add redemptions table ? (for bitcoin transfers only ?)
// add exchanges table ? (for conversion from one currency to another)
//
// network -> scope:  internal / bitcoin / liquid / lightning ?
// add bitcoin_transaction ?  (with redemption attributes)
// add liquid_transaction ?   ()
// add lightning_transaction ? (with LN_invoice_hash)
// add internal_transaction ? ()
//
// context for path, memo, rate, preimage, address, received, fee, tip, confirmed, redeemcode ?


const { DataTypes } = require('sequelize');

const attributes = {
  id: {
    type: DataTypes.INTEGER(11),
    allowNull: false,
    defaultValue: null,
    primaryKey: true,
    autoIncrement: true,
    comment: null,
    field: "id"
  },
  account_id: {
    type: DataTypes.INTEGER(11),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "account_id"
  },
  user_id: {
    type: DataTypes.INTEGER(11),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "user_id"
  },
  path: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "path"
  },
  memo: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "memo"
  },
  hash: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "hash"
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "createdAt"
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "updatedAt"
  },
  rate: {
    type: DataTypes.DOUBLE,
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "rate"
  },
  preimage: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "preimage"
  },
  network: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "network"
  },
  currency: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "currency"
  },
  address: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "address"
  },
  received: {
    type: DataTypes.INTEGER(1),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "received"
  },
  amount: {
    type: DataTypes.DOUBLE,
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "amount"
  },
  fee: {
    type: DataTypes.DOUBLE,
    allowNull: false,
    defaultValue: 0,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "fee"
  },
  tip: {
    type: DataTypes.DOUBLE,
    allowNull: false,
    defaultValue: 0,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "tip"
  },
  redeemed: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "redeemed"
  },
  redeemcode: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "redeemcode"
  },
  confirmed: {
    type: DataTypes.INTEGER(1),
    allowNull: false,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "confirmed"
  }
};

const options = {
  tableName: "payments",
  comment: "",
  indexes: []
};

db["Payment"] = db.define("payments_model", attributes, options);
