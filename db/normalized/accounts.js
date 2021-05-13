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
  asset: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: "Reference to liquid asset on liquid blockchain"
  },
  balance: {
    type: DataTypes.DOUBLE,
    allowNull: false
  },
  pending: {
    type: DataTypes.DOUBLE,
    allowNull: false,
    comment: "Pending balance indicates that the transaction has been detected on the blockchain but not confirmed"
  },
  /* DEPRECATED
  precision: {
    type: DataTypes.INTEGER(11),
    comment: "The decimal precision for the liquid asset "
  }
  */
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
