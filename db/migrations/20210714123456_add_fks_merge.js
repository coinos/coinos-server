exports.up = function(knex) {
  return Promise.all([

    // alter table invoices add foreign key (user_id) references users (id);
    // alter table invoices add foreign key (account_id) references accounts (id);
    knex.schema.alterTable("invoices", function(t) {
      t.foreign('user_id').references('users.id')
      t.foreign('account_id').references('accounts.id')
    }),

    // alter table payments add foreign key (user_id) references users (id);
    // alter table payments add foreign key (account_id) references accounts (id);
    knex.schema.alterTable("payments", function(t) {
      t.foreign('user_id').references('users.id')
      t.foreign('account_id').references('accounts.id')
    }),

    // alter table orders add foreign key (user_id) references users (id);
    // alter table orders add foreign key (a1_id) references accounts (id);
    // alter table orders add foreign key (a2_id) references accounts (id);
    knex.schema.alterTable("orders", function(t) {
      t.foreign('user_id').references('users.id')
      t.foreign('a1_id').references('accounts.id')
      t.foreign('a2_id').references('accounts.id')
    }),

    // alter table deposits add foreign key (user_id) references users (id)
    knex.schema.alterTable("deposits", function(t) {
      t.foreign('user_id').references('users.id')
    }),

    // alter table withdrawals add foreign key (user_id) references users (id)
    knex.schema.alterTable("withdrawals", function(t) {
      t.foreign('user_id').references('users.id')
    }),
  ])
}

exports.down = function(knex) {
}
