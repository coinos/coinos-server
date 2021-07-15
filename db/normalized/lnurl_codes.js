exports.up = function(knex) {
  return knex.schema.createTable('lnurl_codes', function(t) {
    t.increments('id').unsigned().primary();

    t.string('code').notNull();
    t.text('text');
    
    t.timestamps();
  })
}

exports.down = function(knex) {
  return knex.schema.dropTable('lnurl_codes');
};
