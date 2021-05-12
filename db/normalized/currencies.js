const { DataTypes } = require('sequelize');

const attributes = {
  code: {
    type: DataTypes.INTEGER(11),
    primaryKey: true,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING(255)
  }
}
const options = {
  tableName: "currencies",
  comment: "",
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      unique: true,
      fields: ['code']
    }
  ]
};

db["Currency"] = db.define("currencies_model", attributes, options);
