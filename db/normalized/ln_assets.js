const { DataTypes } = require('sequelize');

const attributes = {
  id: {
    type: DataTypes.INTEGER(11),
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING(255),
    comment: "eg 'USD'"
  },
  code: {
    type: DataTypes.INTEGER(11),
    allowNull: false,
    comment: "unique uuid on liquid network"
  }
}
const options = {
  tableName: "codes",
  comment: "Reference subset of liquid network asset codes",
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

db["LnAsset"] = db.define("ln_assets_model", attributes, options);
