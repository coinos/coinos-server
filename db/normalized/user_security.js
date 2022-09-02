export const up = function(knex) {
  return knex.schema.createTable('user_security', function(t) {
    t.increments('id').unsigned().primary();
    t.int('user_id').notNull();
    t.foreign('user_id').references('users.id');

    t.boolean('twofa').notNull().defaultTo(false);
    t.string('pin').notNull();
    t.string('otp_secret').nullable();
    t.string('seed').nullable();

    t.boolean('email_verified').notNull().default(false)
    t.boolean('phone_verified').notNull().default(false)
    t.boolean('kyc_verified').notNull().default(false)

    t.timestamps();
  })
};

export const down = function(knex) {
  return knex.schema.dropTable('user_security');
};