import db from "$db/db";
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
  invoice_id: {
    type: DataTypes.INTEGER(11),
    allowNull: false,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "invoice_id"
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
  tableName: "conversions",
  comment: "",
  indexes: [],
  timestamps: false
};

db["Conversion"] = db.define("conversions_model", attributes, options);
