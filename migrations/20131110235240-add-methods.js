var dbm = require('db-migrate');
var type = dbm.dataType;

exports.up = function(db, callback) {
  db.createTable('methods', {
    id: { type: 'int', primaryKey: true, autoIncrement: true },
    name: { type: 'string' }
  }, callback);
};

exports.down = function(db, callback) {
  db.dropTable('methods');
};
