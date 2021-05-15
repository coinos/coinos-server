const { DataTypes } = require('sequelize');

const attributes = {
  id: {
    type: DataTypes.INTEGER(11),
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  sponsor_id: {
    type: DataTypes.INTEGER(11),
    references: { model: db.User, key: 'id' },
    allowNull: false,
    comment: "Referral made by this user"
  },
  token: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: "Unique referral token"
  },
  user_id: {
    type: DataTypes.INTEGER(11),
    references: { model: db.User, key: 'id' },
    allowNull: true,
    comment: "Referral granted to this user (updated when token used)"
  },
  expiry: {
    type: DataTypes.DATE
  },
  status: {
    type: DataTypes.ENUM,
    values: ['pending', 'active', 'expired', 'cancelled'],
    defaultValue: 'pending'
  }
}

const options = {
  tableName: "referrals",
  comment: "Referrals - unique record for each sponsor / user_id",
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    // are FK fields automatically indexed ?  ... if not add sponsor_id
    {
      unique: true,
      fields: ['user_id']
    }
  ]
};

db["Referral"] = db.define("referrals_model", attributes, options);

// const config = require('./../config')
// const dbc = require('knex')(config.knex)

// dbc.schema.createTable('referrals', function (table) {
//   table.increments();

//   table.string('token')
//   table.date('expiry')
//   table.enu('status', ['active', 'expired', 'closed'])

//   table.dateTime('created_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'))
//   table.dateTime('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'))
// })

// dbc.schema.createTable('waiting_list', function (table) {
//   table.increments();

//   table.string('email')
//   table.enu('status', ['pending', 'activated', 'cancelled']).defaultTo('pending')

//   table.dateTime('created_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'))
//   table.dateTime('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'))
// })  
