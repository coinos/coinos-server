import db from "../db.js";
import { DataTypes } from '@sequelize/core';

const attributes = {
  code: {
    type: DataTypes.STRING(255),
    allowNull: false,
    defaultValue: null,
    primaryKey: true,
    autoIncrement: false,
    comment: null,
    field: "code"
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
};

const options = {
  tableName: "codes",
  comment: "",
  indexes: [],
  timestamps: false
};

db["Code"] = db.define("codes_model", attributes, options);
