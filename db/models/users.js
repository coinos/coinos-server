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
  locked: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "locked"
  },
  verified: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "verified"
  },
  fiat: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "fiat"
  },
  index: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "index"
  },
  ip: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "ip"
  },
  seed: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "seed"
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
  unit: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: 'SAT',
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "unit"
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
  subscriptions: {
    type: DataTypes.TEXT,
    get: function() {
      return JSON.parse(this.getDataValue("subscriptions"));
    },
    set: function(value) {
      return this.setDataValue("subscriptions", JSON.stringify(value));
    },
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "subscriptions"
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
  email: {
    type: DataTypes.STRING(255),
  },
  sms: {
    type: DataTypes.STRING(255),
  }
};

const options = {
  tableName: "users",
  comment: "",
  indexes: []
};

db["User"] = db.define("users_model", attributes, options);
