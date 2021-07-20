exports.up = function(knex) {
  return Promise.all([
    knex.raw("delete from invoices where invoices.account_id not in (select id from accounts)"),
    knex.raw("update users set account_id = 10427 where id = 6262 and account_id = 10428");
    knex.raw("delete from payments where account_id not in (select id from accounts)"),
    knex.raw("delete from orders where a1_id not in (select id from accounts) or a2_id not in (select id from accounts)"),
  ])
}

exports.down = function(knex) {
  return Promise.all([

  ])
}
