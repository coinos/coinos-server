
exports.up = function(knex) {
 return Promise.all([
    knex.raw("UPDATE waiting_list set created_at = '2021-01-01', updated_at='2021-01-01' WHERE updated_at IS NULL OR created_at IS NULL"),
    knex.raw("ALTER TABLE waiting_list MODIFY created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP"),  
    knex.raw("ALTER TABLE waiting_list MODIFY updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP"),  
    
    knex.raw("UPDATE referrals set created_at = '2021-01-01', updated_at='2021-01-01' WHERE updated_at IS NULL OR created_at IS NULL"),
    knex.raw("ALTER TABLE referrals MODIFY created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP"),  
    knex.raw("ALTER TABLE referrals MODIFY updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP")  
 ])
};

exports.down = function(knex) {
  
};
