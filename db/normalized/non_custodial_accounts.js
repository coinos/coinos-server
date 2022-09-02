export const up = function(knex) {
  return knex.schema.createTable('non_custodial_accounts', function(t) {
    t.increments('id').unsigned().primary();
    t.int('account_id').notNull();
    t.foreign('account_id').references('accounts.id');

    // what is the scope / context of these attributes ?
    t.string('path');
    t.string('seed');
    // t.string('hide');
    // t.string('index');
    t.string('pub_key');
    t.string('priv_key');

    t.timestamps();
  })
};

export const down = function(knex) {
  return knex.schema.dropTable('non_custodial_accounts');
};

// const { DataTypes } = require('@sequelize/core');

// const attributes = {
//   id: {
//     type: DataTypes.INTEGER(11),
//     primaryKey: true,
//     autoIncrement: true,
//     allowNull: false
//   },
//   account_id: {
//     type: DataTypes.INTEGER(11),
//     references: { model: Account, key: 'id' },
//     allowNull: false,
//     comment: "Reference to account"
//   },
//   path: {
//     type: DataTypes.STRING(255),
//     comment: "What is this ?"
//   },
//   seed: {
//     type: DataTypes.STRING(255),
//     comment: "What is this ?"
//   },
//   network: {
//     type: DataTypes.INTEGER(11),
//     references: { model: Network, key: 'id' },
//     allowNull: false,
//     comment: "Reference to network"
//   },
//   domain: {
//     type: DataTypes.STRING(255),
//     comment: "What is this ? ... is it unique or an enum ?"
//   },
//   ticker: {
//     type: DataTypes.STRING(255),
//     comment: "What is this ?"
//   },
//   hide: {
//     type: DataTypes.STRING(255),
//     comment: "What is this ?"
//   },
//   index: {
//     type: DataTypes.STRING(255),
//     comment: "What is this ?"
//   },
//   pub_key: {
//     type: DataTypes.STRING(255),
//     comment: "What is this ?"
//   },
//   priv_key: {
//     type: DataTypes.STRING(255),
//     comment: "What is this ?"
//   }
// }
// const options = {
//   tableName: "non_custodial_accounts",
//   comment: "",
//   timestamps: true,
//   createdAt: 'created_at',
//   updatedAt: 'updated_at',
//   indexes: [
//     {
//       unique: true,
//       fields: ['account_id']
//     }
//   ]
// };

// db["NonCustodialAccount"] = db.define("non_custodial_accounts_model", attributes, options);
