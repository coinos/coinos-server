export const up = function(knex) {
  return knex.schema.createTable('withdrawals', function(t) {
    t.increments('id').unsigned().primary();

    t.int('debit_id').notNull();
    t.foreign('debit_id').references('debits.id');

    t.int('bank_account_id').notNull();
    t.foreign('bank_account_id').references('bank_accounts.id');

    t.double('withdrawal_fee').notNull().defaultTo(0)

    t.text('notes');

    t.timestamps();
  })
};

export const down = function(knex) {
  return knex.schema.dropTable('withdrawals');
};

// Changes:
//
// bank info -> bank_account records

// const { DataTypes } = require('sequelize');

// const attributes = {
//   id: {
//     type: DataTypes.INTEGER(11),
//     allowNull: false,
//     defaultValue: null,
//     primaryKey: true,
//     autoIncrement: true,
//     comment: null,
//     field: "id"
//   },
//   amount: {
//     type: DataTypes.DOUBLE,
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "amount"
//   },
//   user_id: {
//     type: DataTypes.INTEGER(11),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "user_id"
//   },
//   createdAt: {
//     type: DataTypes.DATE,
//     allowNull: false,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "createdAt"
//   },
//   updatedAt: {
//     type: DataTypes.DATE,
//     allowNull: false,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "updatedAt"
//   },
//   transit: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "transit"
//   },
//   institution: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "institution"
//   },
//   account: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "account"
//   },
//   email: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "email"
//   },
//   notes: {
//     type: DataTypes.TEXT,
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "notes"
//   },
// };

// const options = {
//   tableName: "withdrawals",
//   comment: "",
//   indexes: []
// };

// db["Withdrawal"] = db.define("withdrawals_model", attributes, options);
