exports.up = function(knex) {
  return knex.schema.createTable('waiting_list', function(t) {
    t.increments('id').unsigned().primary();

    t.string('email').notNull();
    t.string('phone').notNull();
    t.enu('status', ['pending', 'activated', 'expired', 'cancelled']).notNull();
  
    t.timestamps();
  })
}

exports.down = function(knex) {
  return knex.schema.dropTable('waiting_list');
};

// const { DataTypes } = require('sequelize');

// const attributes = {
//   id: {
//     type: DataTypes.INTEGER(11),
//     primaryKey: true,
//     autoIncrement: true,
//     allowNull: false
//   },
//   email: {
//     type: DataTypes.STRING(255),
//     validate: {
//       isEmail: true
//     }
//   },
//   sms: {
//     type: DataTypes.STRING(255),
//     validate: {
//       is: /^[0-9]+$/ // replace spaces, brackets, dashes dynamically prior to create
//     }
//   },
//   status: {
//     type: DataTypes.ENUM,
//     values: ['pending', 'activated', 'expired', 'cancelled'],
//     defaultValue: 'pending',
//     allowNull: false
//   }
// }

// const options = {
//   tableName: "waiting_list",
//   comment: "Users on waiting list",
//   timestamps: true,
//   createdAt: 'created_at',
//   updatedAt: 'updated_at',
//   indexes: [
//     {
//       unique: true,
//       fields: ['email', 'sms']
//     }
//   ]
// };

// db["WaitingList"] = db.define("waiting_list_model", attributes, options);
