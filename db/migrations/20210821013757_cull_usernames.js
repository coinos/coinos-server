
exports.up = function(knex) {
  return Promise.all([
    knex.raw("UPDATE users SET username = REPLACE(username, ' ', '') WHERE username like '% '"), // just in case valid users have trailing spaces in their username
    knex.raw("DELETE FROM users WHERE !(username REGEXP '^[a-zA-Z0-9\.\_\@\-]{3,32}$'"),
  ])
};

exports.down = function(knex) {
  
};
