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
  amount: {
    type: DataTypes.DECIMAL(10,2),
    allowNull: false
  },
  institution: {
    type: DataTypes.INTEGER(11),
    references: { model: Institution, key: 'id' },
    allowNull: false,
    comment: "Reference to bank institution"
  },
  transit: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  account: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  notes: {
    type: DataTypes.TEXT
  },
  status: {
    type: DataTypes.ENUM,
    values: ['pending', 'debited', 'failed'],
    defaultValue: 'pending'
  }
}

const options = {
  tableName: "withdrawals",
  comment: "",
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
  ]
};

db["Withdrawal"] = db.define("withdrawals_model", attributes, options);
