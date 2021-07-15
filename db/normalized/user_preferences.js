exports.up = function(knex) {
  return knex.schema.createTable('user_preferences', function(t) {
    t.increments('id').unsigned().primary();
    t.int('user_id').notNull();
    t.foreign('user_id').references('users.id');

    t.enum('default_unit', ['SAT', 'BTC', 'CAD']).notNull().defaultTo('SAT');
    t.enum('default_currency', ['CAD', 'USD']).notNull().defaultTo('CAD');
    t.enum('default_fiat', ['CAD', 'USD']).notNull().defaultTo('CAD');
    t.set('show_currencies', ['CAD', 'USD']).notNull().defaultTo('CAD');

    t.timestamps();
  })
}

exports.down = function(knex) {
  return knex.schema.dropTable('user_preferences');
};