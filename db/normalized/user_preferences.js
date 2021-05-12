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
  username: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  gravitar: {
    type: DataTypes.STRING(255),
  },
  fiat: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
    comment: "What is this for ?"
  },
  default_crypto_unit: {
    type: DataTypes.ENUM,
    values: ['SAT', 'BTC'],
    defaultValue: 'SAT',
    allowNull: false
  },
  default_currency_code: {
    type: DataTypes.INTEGER(11),
    references: { model: Currency, key: 'code' },
    defaultValue: "CAD",
    allowNull: false
  },
  currencies: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: ["USD"],
    comment: "List of currency options to show for this user",
  }
}

const options = {
  tableName: "user_preferences",
  comment: "settings that can be controlled by users themselves",
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {fields: ['user_id']}
  ]
};

db["UserPreference"] = db.define("user_preferences_model", attributes, options);
