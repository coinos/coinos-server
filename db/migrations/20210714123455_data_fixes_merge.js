exports.up = function(knex) {
  return Promise.all([
    knex.raw("delete from invoices where invoices.account_id not in (select id from accounts)"),
    knex.raw("update users set account_id = 10427 where id = 6262 and account_id = 10428");
    knex.raw("delete from payments where account_id not in (select id from accounts)"),
    knex.raw("delete from orders where a1_id not in (select id from accounts) or a2_id not in (select id from accounts)"),
    
    knex.raw("alter table orders drop rate");
    knex.raw("alter table orders add rate double");
    knex.raw("update orders set rate = v1/v2");

  ])
}

exports.down = function(knex) {
  return Promise.all([

  ])
}
