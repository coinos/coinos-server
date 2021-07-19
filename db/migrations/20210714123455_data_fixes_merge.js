exports.up = function(knex) {
  return Promise.all([

    // check with : 
    knex.raw("update invoices as m left join accounts on accounts.id=account_id left join users on users.id = m.user_id set m.account_id=users.account_id where m.account_id is not null and accounts.id is null"),
    
    knex.raw("update users left join accounts on users.account_id=accounts.id left join accounts as n on n.user_id = users.id set users.account_id=n.id where account_id is not null and accounts.id is null"),

    knex.raw("update payments as m left join accounts on accounts.id=account_id left join users on users.id = m.user_id set m.account_id=users.account_id where m.account_id is not null and accounts.id is null"),
    
    knex.raw("update orders as m left join accounts on accounts.id=m.a1_id left join users on users.id = m.user_id set m.a1_id=users.account_id where m.a1_id is not null and accounts.id is null"),

    knex.raw("update orders as m left join accounts on accounts.id=m.a2_id left join users on users.id = m.user_id set m.a2_id=users.account_id where m.a2_id is not null and accounts.id is null"),

  ])
}

exports.down = function(knex) {
  return Promise.all([

  ])
}