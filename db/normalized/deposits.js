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
  deposit_code: {
    type: DataTypes.STRING(255),
    comment: "Unique randomly generated code to be put in the interac deposit reference/message to link the deposit to this record/user",
  },
  status: {
    type: DataTypes.ENUM,
    values: ['pending', 'credited', 'failed'],
    defaultValue: 'pending'
  }
}

const options = {
  tableName: "deposits",
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

db["Deposit"] = db.define("deposits_model", attributes, options);
