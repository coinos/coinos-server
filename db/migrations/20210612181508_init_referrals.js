exports.up = function(knex) {
  return Promise.all([
    knex.schema.dropTableIfExists('referrals'),

    knex.schema.createTable('referrals', function(t) {
      t.increments('id').unsigned().primary();
      t.integer('user_id').nullable();
      t.foreign('user_id').references('users.id');
  
      t.integer('sponsor_id').notNull();
      t.foreign('sponsor_id').references('users.id');
  
      t.string('token').notNull();
      t.string('expiry').nullable();
      t.enum('status', ['available', 'used', 'expired', 'cancelled']).notNull().defaultTo('available');
  
      t.timestamps(true, true);
    })
  ])
};

exports.down = function(knex) {
  return knex.schema.dropTable('referrals');
};
