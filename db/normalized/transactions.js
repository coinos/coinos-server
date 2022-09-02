export const up = function(knex) {
  return knex.schema.createTable('transactions', function(t) {
      t.increments('id').unsigned().primary();

      t.enu('type', ['deposit', 'withdrawal', 'transfer', 'exchange', 'invoice', 'voucher', 'new asset'])

      // t.text('notes');

      t.timestamps();
  })
};

export const down = function(knex) {
return knex.schema.dropTable('transactions');
};

// Changes: 
//
// Deposit = deposit + credit
// Withdrawal = withdrawal + debit
// Transfer = credit + debit
// Exchange = credit + debit + debit + credit
// Invoice = invoice + debit ?
// Voucher = invoice + debit ?
// New Asset = liquid_asset + credit

//
// context for path, memo, rate, preimage, address, received, fee, tip, confirmed, redeemcode ?
export const up = function(knex) {
  return knex.schema.createTable('transactions', function(t) {
    t.increments('id').unsigned().primary();

    t.enu('type', ['deposit', 'withdrawal', 'order', 'transfer', 'invoice', 'voucher'])

    t.timestamps();
  })
};

export const down = function(knex) {
return knex.schema.dropTable('transactions');
};