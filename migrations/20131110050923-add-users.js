var dbm = require('db-migrate');
var type = dbm.dataType;

exports.up = function(db, callback) {
  db.createTable('users', {
      id: { type: 'int', primaryKey: true },
      username: { type: 'string' },
      password: { type: 'string' },
      first_name: { type: 'string' },
      last_name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      company: { type: 'string' },
      category: { type: 'string' },
      website: { type: 'string' },
      location: { type: 'string' },
      city: { type: 'string' },
      postal_code: { type: 'string' },
      province: { type: 'string' },
      country: { type: 'string' }
    }, callback);
};

exports.down = function(db, callback) {
  db.dropTable('users', callback);
};
