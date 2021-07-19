exports.up = function(knex) {
  return Promise.all([
    knex.schema.dropTableIfExists('reset'),
    knex.schema.dropTableIfExists('naughty'),
    knex.schema.dropTableIfExists('cheaters'),

    knex.raw("UPDATE accounts set createdAt = '2020-01-01' where createdAt < '2020-01-01'"),
    knex.raw("UPDATE accounts set updatedAt = '2020-01-01' where updatedAt < '2020-01-01'"),
    knex.raw("ALTER TABLE accounts modify `contract` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL"),

    knex.schema.alterTable('orders', function(t) {
      t.dropColumn('a1');
      t.dropColumn('a2');
    }),

    knex.schema.alterTable("users", function(t) {
      t.string('authyId').nullable();
      t.dropColumn('symbol');
    }),

    knex.raw("ALTER TABLE users MODIFY `subscriptions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL"),

  ])
}

exports.down = async function(knex) {
  return Promise.all([
    knex.schema.table("orders", function(t) {
      t.integer("a1");
      t.integer("a2")
    }),

    knex.schema.table("users", function(t) {
      t.string("symbol");
      t.dropColumn("unit");
      t.dropColumn("authyId");
    }),
  ])
}