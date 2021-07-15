exports.up = function(knex) {
  return knex.schema.createTable('ln_keys', function(t) {
    t.increments('id').unsigned().primary();

    t.int('user_id').notNull();
    t.foreign('user_id').references('users.id');

    t.string('hex').notNull();
    
    t.timestamps();
  })
}

exports.down = function(knex) {
  return knex.schema.dropTable('ln_keys');
};