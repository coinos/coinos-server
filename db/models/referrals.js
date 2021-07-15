const { DataTypes } = require('sequelize');

const attributes = {
  id: {
    type: DataTypes.INTEGER(11),
    allowNull: false,
    defaultValue: null,
    primaryKey: true,
    autoIncrement: true,
    comment: null,
    field: "id"
  },
  user_id: {
    type: DataTypes.INTEGER(11),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "user_id"
  },
  sponsor_id: {
    type: DataTypes.INTEGER(11),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "sponsor_id"
  },

  token: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "token"
  },
  expiry: {
    type: DataTypes.DATE(),
    allowNull: true,
    defaultValue: null,
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "token"
  },
  status: {
    type: DataTypes.ENUM,
    values: ['available', 'used', 'expired', 'cancelled'],
    allowNull: true,
    defaultValue: 'available',
    primaryKey: false,
    autoIncrement: false,
    comment: null,
    field: "token"
  }
};

const options = {
  tableName: "referrals",
  comment: "",
  indexes: []
};

db["Referral"] = db.define("referrals_model", attributes, options);

//   exports.up = function(knex) {
//   return knex.schema.createTable('referrals', function(t) {
//     t.increments('id').unsigned().primary();
//     t.int('user_id').nullable();
//     t.foreign('user_id').references('users.id');

//     t.int('sponsor_id').notNull();
//     t.foreign('sponsor_id').references('users.id');

//     t.string('token').notNull();
//     t.string('expiry').nullable();
//     t.enum('status', ['available', 'used', 'expired', 'cancelled']).notNull().defaultTo('available');

//     t.timestamps();
//   })
// };

// exports.down = function(knex) {
//   return knex.schema.dropTable('referrals');
// };
