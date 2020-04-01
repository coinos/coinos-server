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
  username: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "username"
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "password"
  },
  liquid: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "liquid"
  },
  confidential: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "confidential"
  },
  unit: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: 'SAT',
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "unit"
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
  symbol: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "symbol"
  },
  otpsecret: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: "CAD",
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "otpsecret"
  },
  currency: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: "CAD",
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "currency"
  },
  currencies: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: ["USD"],
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "currencies"
  },
  pubkey: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "pubkey"
  },
  privkey: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "privkey"
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
  index: {
    type: DataTypes.INTEGER(11),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "index"
  },
  balance: {
    type: DataTypes.INTEGER(11),
    allowNull: false,
    defaultValue: "0",
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "balance"
  },
  channel: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "channel"
  },
  readonlypw: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "readonlypw"
  },
  limit: {
    type: DataTypes.INTEGER(11),
    allowNull: true,
    defaultValue: "0",
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "limit"
  },
  fbtoken: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "fbtoken"
  },
  friend: {
    type: DataTypes.INTEGER(1),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "friend"
  },
  pending: {
    type: DataTypes.INTEGER(11),
    allowNull: true,
    defaultValue: "0",
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "pending"
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "name"
  },
  pic: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "pic"
  },
  twofa: {
    type: DataTypes.INTEGER(1),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "twofa"
  },
  pin: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "pin"
  },
};

const options = {
  tableName: "users",
  comment: "",
  indexes: []
};

db["User"] = db.define("users_model", attributes, options);
