exports.up = function(knex) {
  return Promise.all([

    knex.schema.alterTable("invoices", function(t) {
      t.foreign('user_id').references('users.id')
      t.foreign('account_id').references('accounts.id')
    }),

    knex.schema.alterTable("payments", function(t) {
      t.foreign('user_id').references('users.id')
      t.foreign('account_id').references('accounts.id')
    }),

    knex.schema.alterTable("orders", function(t) {
      t.foreign('user_id').references('users.id')
      t.foreign('a1_id').references('accounts.id')
      t.foreign('a2_id').references('accounts.id')
    }),

    knex.schema.alterTable("deposits", function(t) {
      t.foreign('user_id').references('users.id')
    }),

    knex.schema.alterTable("withdrawals", function(t) {
      t.foreign('user_id').references('users.id')
    }),
  ])
}

exports.down = function(knex) {
  return Promise.all([
    knex.schema.table("users", function(t) {
      t.dropColumn("email");
      t.dropColumn("phone");
      t.dropColumn("admin");
    })
  ])
}