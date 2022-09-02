export const up = function(knex) {
  return knex.schema.createTable('accounts', function(t) {
    t.increments('id').unsigned().primary();
    t.int('user_id').notNull();
    t.foreign('user_id').references('users.id');

    t.int('uuid').notNull();

    t.double('balance');
    t.double('pending');

    t.enu('network', ['Bitcoin', 'Liquid', 'Lightning', 'CoinOS']).notNull();

    t.longtext('contract').collate('utf8mb4').nullable(); // custodial ?

    // knex.raw("ALTER TABLE accounts MODIFY `contract` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL")
    
    // t.string('hide');
    // t.string('index');

    t.int('liquid_asset_id').notNull();
    t.foreign('liquid_asset_id').references('liquid_assets.id');

    t.timestamps();
  })
};

export const down = function(knex) {
  return knex.schema.dropTable('accounts');
};

// Change
//
// move assets fields (asset, ticker, name, precision...) to separate liquid_assets reference

// separate network specific fields to bitcoin_accounts / liquid_accounts / coinos_accounts tables ? or just non_custodial ?
// eg liquid -> liquid_asset info
//    non-custodial ? -> privkey, pubkey, path, seed ?
//    contract, hide, index ?
//


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
//   path: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "path"
//   },
//   seed: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "seed"
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
//   name: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "name"
//   },
//   contract: {
//     type: DataTypes.TEXT,
//     get: function() {
//       return JSON.parse(this.getDataValue("contract"));
//     },
//     set: function(value) {
//       return this.setDataValue("contract", JSON.stringify(value));
//     },
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "contract"
//   },
//   domain: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "domain"
//   },
//   ticker: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "ticker"
//   },
//   asset: {
//     type: DataTypes.STRING(255),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "asset"
//   },
//   balance: {
//     type: DataTypes.DOUBLE,
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "balance"
//   },
//   pending: {
//     type: DataTypes.DOUBLE,
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "pending"
//   },
//   hide: {
//     type: DataTypes.BOOLEAN,
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "hide"
//   },
//   index: {
//     type: DataTypes.INTEGER(11),
//     allowNull: false,
//     defaultValue: 0,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "index"
//   },
//   privkey: {
//     type: DataTypes.STRING,
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "privkey"
//   },
//   pubkey: {
//     type: DataTypes.STRING,
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "pubkey"
//   },
//   precision: {
//     type: DataTypes.INTEGER(11),
//     allowNull: true,
//     defaultValue: null,
//     primaryKey: false,
//     autoIncrement: false,
//     comment: null,
//     field: "precision"
//   },
// };

// const options = {
//   tableName: "accounts",
//   comment: "",
//   indexes: []
// };

// db["Account"] = db.define("accounts_model", attributes, options);
