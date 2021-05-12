const { DataTypes } = require('sequelize');

const attributes = {
  id: {
    type: DataTypes.INTEGER(11),
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  uuid: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: "unique UUID as more secure reference"
  },
  user_id: {
    type: DataTypes.INTEGER(11),
    references: { model: User, key: 'id' },
    allowNull: false,
    comment: "Referral granted to this user (updated when token used)"
  },
  asset_id: {
    type: DataTypes.INTEGER(11),
    references: { model: Asset, key: 'code' },
    allowNull: false,
    comment: "Reference to asset"
  },
  balance: {
    type: DataTypes.DOUBLE,
    allowNull: false
  },
  pending: {
    type: DataTypes.DOUBLE,
    allowNull: false,
    comment: "What is this ?"
  },
  precision: {
    type: DataTypes.INTEGER(11),
    comment: "what is this for ? ... is it unique for each account ?"
  }
}
const options = {
  tableName: "accounts",
  comment: "",
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      unique: true,
      fields: ['uuid']
    }
  ]
};

db["Account"] = db.define("accounts_model", attributes, options);
