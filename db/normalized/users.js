export const up = function(knex) {
  return knex.schema.createTable('users', function(t) {
    t.increments('id').unsigned().primary();

    t.string('uuid').notNull().index();
    t.string('username').notNull().index();
    t.string('password').notNull();
    t.string('email').nullable().index();
    t.string('phone').nullable();
    t.enum('access', ['Anonymous', 'Registered', 'Admin']).notNull().defaultTo('Anonymous');

    t.timestamps();
  })
};

export const down = function(knex) {
  return knex.schema.dropTable('users');
};