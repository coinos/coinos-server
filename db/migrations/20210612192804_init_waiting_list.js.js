
exports.up = function(knex) {
    return knex.schema.createTable('waiting_list', function(t) {
        t.increments('id').unsigned().primary();

        t.string('email').nullable();
        t.string('sms').nullable();
        t.enum('status', ['pending', 'contacted', 'registered', 'cancelled')).notNull().defaultTo('pending');
        t.int('user_id').notNull();
	t.foreign('user_id').references('users.user_id');

	t.timestamps();  
};

exports.down = function(knex) {
    return knex.schema.dropTable('waiting_list');
};
