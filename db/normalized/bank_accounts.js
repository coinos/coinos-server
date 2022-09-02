export const up = function(knex) {
  return knex.schema.createTable('bank_accounts', function(t) {
    t.increments('id').unsigned().primary();
    t.int('user_id').notNull();
    t.foreign('user_id').references('users.id');

    t.int('transit_number');
    t.int('institution_number');
    t.int('account_number');

    t.string('swift');
    t.string('iban');
    
    t.timestamps();
  })
};

export const down = function(knex) {
  return knex.schema.dropTable('user_security');
};

// Changes:
//
// bank info -> bank_account records
