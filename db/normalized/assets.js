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
  tableName: "assets",
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

db["Asset"] = db.define("assets_model", attributes, options);
