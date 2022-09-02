import db from "../db.js";
import { DataTypes } from '@sequelize/core';

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
  invoice_id: {
    type: DataTypes.INTEGER(11),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "invoice_id"
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
  },
  fee_payment_id: {
    type: DataTypes.INTEGER(11),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "fee_payment_id"
  }
};

const options = {
  tableName: "payments",
  comment: "",
  indexes: []
};

db["Payment"] = db.define("payments_model", attributes, options);
