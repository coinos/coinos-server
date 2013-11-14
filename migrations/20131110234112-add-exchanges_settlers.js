var dbm = require('db-migrate');
var type = dbm.dataType;

exports.up = function(db, callback) {
  db.createTable('exchanges_settlers', {
      user_id: { type: 'int' },
      exchange_id: { type: 'int' },
      api_key: { type: 'string' }
    }, callback);
};

exports.down = function(db, callback) {
  db.dropTable('exchanges_settlers');
};
