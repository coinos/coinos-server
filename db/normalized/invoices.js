export const up = function(knex) {
  return knex.schema.createTable('invoices', function(t) {
    t.increments('id').unsigned().primary();

    t.int('transfer_id').notNull();
    t.foreign('transfer_id').references('transfers.id');

    t.enu('network', ['Bitcoin', 'Liquid', 'Lightning', 'CoinOS']).notNull();

    t.string('bolt11'); // was 'text'

    // Clarify ??? - break out ?  - context ? include everything encoded in hash... 
    t.double('amount');

    // Exchanges 
    // ( are there a couple of types of invoices ? - eg checkout / voucher / receive ... with different attributes ?)
    t.double('rate')
    t.string('currency')
    t.double('tip')

    t.string('path')
    t.string('uuid')
    t.string('memo')
    t.string('unconfidential')
    t.string('address')
    t.string('received')

    t.timestamps();
  })
};

export const down = function(knex) {
  return knex.schema.dropTable('invoices');
};


// Variations: ?
// wallet -> receive - fields ?
// checkout - fields ?
// voucher - fields ?

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
//   account_id: {
//     type: DataTypes.INTEGER(11),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "account_id"
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
//   text: {
//     type: DataTypes.TEXT,
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "text"
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
//   path: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "path"
//   },
//   rate: {
//     type: DataTypes.DOUBLE,
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "rate"
//   },
//   uuid: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "uuid"
//   },
//   memo: {
//     type: DataTypes.TEXT,
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "memo"
//   },
//   network: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "network"
//   },
//   currency: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "currency"
//   },
//   unconfidential: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "unconfidential"
//   },
//   address: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "address"
//   },
//   received: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "received"
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
//   tip: {
//     type: DataTypes.DOUBLE,
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "tip"
//   },
// };

// const options = {
//   tableName: "invoices",
//   comment: "",
//   indexes: []
// };

// db["Invoice"] = db.define("invoices_model", attributes, options);
