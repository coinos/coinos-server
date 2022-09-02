export const up = function(knex) {
  return knex.schema.createTable('vouchers', function(t) {
    t.increments('id').unsigned().primary();

    t.int('invoice_id').notNull();
    t.foreign('invoice_id').references('invoices.id');

    t.string('redemption_code').notNull();
  
    t.enu('status', ['pending', 'redeemed', 'cancelled']).notNull();
  
    t.timestamps();
  })
};

export const down = function(knex) {
  return knex.schema.dropTable('vouchers');
};