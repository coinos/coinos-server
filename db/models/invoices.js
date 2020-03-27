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
  user_id: {
    type: DataTypes.INTEGER(11),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "user_id"
  },
  text: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "text"
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
    type: DataTypes.STRING(255),
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
  tip: {
    type: DataTypes.DOUBLE,
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "tip"
  },
};

const options = {
  tableName: "invoices",
  comment: "",
  indexes: []
};

db["Invoice"] = db.define("invoices_model", attributes, options);
