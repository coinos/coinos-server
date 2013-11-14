var dbm = require('db-migrate');
var type = dbm.dataType;

exports.up = function(db, callback) {
  db.createTable('addresses', {
    id: { type: 'int', primaryKey: true, autoIncrement: true },
      merchant_id: { type: 'int' },
      address: { type: 'string' }
    }, callback);
};

exports.down = function(db, callback) {
  db.dropTable('addresses', callback);
};
