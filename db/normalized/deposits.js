export const up = function(knex) {
  return knex.schema.createTable('deposits', function(t) {
    t.increments('id').unsigned().primary();

    t.int('credit_id').notNull();
    t.foreign('credit_id').references('credits.id');

    t.string('confirmation_code');

    t.timestamps();
  })
};

export const down = function(knex) {
  return knex.schema.dropTable('deposits');
};

// Changes:
// 
// reference transaction
// reference account rather than user
// credited - redundant with confirmation_code ?
// code -> confirmation_code


// const { DataTypes } = require('@sequelize/core');

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
//   credited: {
//     type: DataTypes.BOOLEAN,
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "credited"
//   },
//   code: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "code"
//   },
// };

// const options = {
//   tableName: "deposits",
//   comment: "",
//   indexes: []
// };

// db["Deposit"] = db.define("deposits_model", attributes, options);
