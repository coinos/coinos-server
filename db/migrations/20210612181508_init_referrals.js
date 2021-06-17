
exports.up = function(knex) {
    return knex.schema.createTable('referrals', function(t) {
        t.increments('id').unsigned().primary();

        t.string('token').notNull();
        t.string('expiry').nullable();
        t.enum('status', ['pending', 'active', 'expired', 'cancelled')).notNull().defaultTo('pending');
        t.int('sponsor_id').notNull();
	t.foreign('sponsor_id').references('users.user_id')
        t.int('user_id').nullable();
	t.foreign('user_id').references('users.user_id')

        t.timestamps();
};

exports.down = function(knex) {
  return knex.schema.dropTable('referrals');
};
