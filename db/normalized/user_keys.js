const { DataTypes } = require('sequelize');

const attributes = {
  id: {
    type: DataTypes.INTEGER(11),
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  user_id: {
    type: DataTypes.INTEGER(11),
    references: { model: User, key: 'id' },
    allowNull: false,
    comment: "Referral granted to this user (updated when token used)"
  },
  otpsecret: {
    type: DataTypes.STRING(255),
    comment: "Used for ... ?",
  },
  pin: {
    type: DataTypes.STRING(255),
    comment: "Used for ... ?
  },
  seed: {
    type: DataTypes.STRING(255),
    comment: "Used for ... ?
  },
  ip: {
    type: DataTypes.STRING(255),
    comment: "Used for ... ?
  },
  index: {
    type: DataTypes.STRING(255),
    comment: "Used for ... ?
  }
}
const options = {
  tableName: "user_keys",
  comment: "",
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
  ]
};

db["UserKey"] = db.define("user_keys_model", attributes, options);
