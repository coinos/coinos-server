var dbm = require('db-migrate');
var type = dbm.dataType;

exports.up = function(db, callback) {
  db.createTable('merchants_settlers', {
      merchant_id: { type: 'int' },
      settler_id: { type: 'int' },
      schedule: { type: 'int' },
      method_id: { type: 'int' }
    }, callback);
};

exports.down = function(db, callback) {
  db.dropTable('merchants_settlers', callback);
};
