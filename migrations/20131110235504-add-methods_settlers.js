var dbm = require('db-migrate');
var type = dbm.dataType;

exports.up = function(db, callback) {
  db.createTable('methods_settlers', {
      method_id: { type: 'int' },
      settler_id: { type: 'int' }
    }, callback);
};

exports.down = function(db, callback) {
  db.dropTable('methods_settlers', callback);
};
