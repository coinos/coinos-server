
exports.up = function(knex) {
  return Promise.all([

    // move security fields to separate t (potentially different access permissions)
    
    knex.schema.createTable('user_security', function (t) {
      t.increments('id').unsigned().primary();
      t.int('user_id').notNull();
      t.foreign('user_id').references('users.user_id');

      t.boolean('twofa').notNull().defaultTo(false);
      t.string('pin').notNull();
      t.string('otp_secret').nullable();
      t.string('seed').nullable();
    },

    knex.raw("INSERT INTO user_security (user_id, twofa, pin, otp_secret, seed) SELECT users.id, twofa, pin, otpsecret, seed FROM users"),

    // move user-customizeable fields to separate t (potentially different access permissions)

    knex.schema.createTable('user_preferences', function (t) {
      t.increments('id').unsigned().primary();
      t.int('user_id').notNull();
      t.foreign('user_id').references('users.user_id');

      t.enum('default_unit', ['SAT', 'BTC', 'CAD']).notNull().defaultTo('SAT');
      t.enum('default_currency', ['CAD', 'USD']).notNull().defaultTo('CAD');
      t.enum('default_fiat', ['CAD', 'USD']).notNull().defaultTo('CAD');
      t.set('show_currencies', ['CAD', 'USD']).notNull().defaultTo('CAD');
    }
    
    knex.raw("INSERT INTO user_preferences (user_id, default_unit, default_currency, default_fiat, show_currencies) SELECT users.id, unit, currency, fiat, currencies FROM users"),
    
    // remove deprecated fields
    
    knex.schema.table('users', function (t) {
      t.string('uuid');
      t.enum('access', ['Anonymous', 'Member', 'Admin']).defaultTo('Anonymous');

      t.dropColumn('account_id');
      t.dropColumn('unit');
      t.dropColumn('fiat');
      t.dropColumn('currency');
      t.dropColumn('currencies');
    },
  ])
  
};

exports.down = function(knex) {
  
};
