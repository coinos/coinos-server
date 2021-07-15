exports.up = function(knex) {
  return knex.schema.createTable('orders', function(t) {
    t.increments('id').unsigned().primary();

    t.int('sell_transfer_id').notNull();
    t.foreign('sell_transfer_id').references('transfers.id');
    
    t.int('buy_transfer_id').notNull();
    t.foreign('buy_transfer_id').references('transfers.id');

    // t.int('exchange_id').notNull();
    // t.foreign('exchange_id').references('exchanges.id');

    t.double('exchange_rate').notNull();
    // t.double('amount').notNull();

    t.enu('status', ['Submitted', 'Accepted', 'Cancelled']).notNull();
    t.date('completion_date')

    t.timestamps();
  })
}
 

// Bid / Accepted ... separate into Bid (credit + debit),  Accepted (credit + debit)

exports.down = function(knex) {
  return knex.schema.dropTable('orders');
};

