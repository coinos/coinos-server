exports.up = function(knex) {
  return knex.schema.createTable('referrals', function(t) {
    t.increments('id').unsigned().primary();
    t.int('user_id').nullable();
    t.foreign('user_id').references('users.id');

    t.int('sponsor_id').notNull();
    t.foreign('sponsor_id').references('users.id');

    t.string('token').notNull();
    t.string('expiry').nullable();
    t.enum('status', ['available', 'used', 'expired', 'cancelled']).notNull().defaultTo('available');

    t.timestamps();
  })
};

exports.down = function(knex) {
  return knex.schema.dropTable('referrals');
};
