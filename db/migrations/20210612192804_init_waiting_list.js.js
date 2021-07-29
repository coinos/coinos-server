exports.up = function(knex) {

    return Promise.all([
      knex.schema.dropTableIfExists('waiting_list'),

      knex.schema.createTable('waiting_list', function(t) {
        t.increments('id').unsigned().primary();
    
        t.string('email').notNull();
        t.string('phone').notNull();
        t.enu('status', ['pending', 'activated', 'expired', 'cancelled']).notNull();
  
        t.integer('user_id').nullable();
        t.foreign('user_id').references('users.id');
        t.text('notes').nullable();

        t.timestamps();
      })
    ])
}
  
exports.down = function(knex) {
    return knex.schema.dropTable('waiting_list');
}