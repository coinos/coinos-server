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
  asset: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "asset"
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
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "fee"
  },
  tip: {
    type: DataTypes.DOUBLE,
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "tip"
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
