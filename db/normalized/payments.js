const { DataTypes } = require('sequelize');

const attributes = {
  id: {
    type: DataTypes.INTEGER(11),
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  account_id: {
    type: DataTypes.INTEGER(11),
    references: { model: Account, key: 'id' },
    allowNull: true,
    comment: "Reference to account"
  },
  amount: {
    type: DataTypes.DOUBLE,
    allowNull: false
  },
  path: {
    type: DataTypes.STRING(255),
    comment: "What is this ?"
  },
  memo: {
    type: DataTypes.TEXT,
    comment: "What is this ?"
  },
  hash: {
    type: DataTypes.TEXT,
    comment: "What is this ?"
  },
  precision: {
    type: DataTypes.INTEGER(11),
    comment: "what is this for ? ... is it unique for each account ?"
  }
}
const options = {
  tableName: "payments",
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

db["Payment"] = db.define("payments_model", attributes, options);
