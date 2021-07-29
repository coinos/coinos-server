exports.up = function(knex) {
  return Promise.all([
    knex.raw("delete from invoices where invoices.account_id not in (select id from accounts)"),
    knex.raw("delete from orders where orders.a1_id not in (select id from accounts) or orders.a2_id not in (select id from accounts)"),
    knex.raw("update users set account_id = 10427 where id = 6262 and account_id = 10428"),
    knex.raw("delete from payments where account_id not in (select id from accounts)"),
    knex.raw("alter table orders drop rate"),
    knex.raw("alter table orders add rate double"),
    knex.raw("update orders set rate = v1/v2"),

    knex.raw('update accounts left join users on accounts.user_id = users.id set user_id = null where length(username) > 32'),
    knex.raw('update accounts left join users on accounts.user_id = users.id set user_id = null where users.id is null'),
    knex.raw('delete from accounts where user_id is null'),
    knex.raw('delete from users where length(username) > 32')
  ])
}

exports.down = function(knex) {
  return Promise.all([

  ])
}
