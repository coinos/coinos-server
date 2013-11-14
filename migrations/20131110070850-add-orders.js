var dbm = require('db-migrate');
var async = require('async');
var type = dbm.dataType;

exports.up = function(db, callback) {
  async.series([
    db.createTable('orders', {
      id: { type: 'int', primaryKey: true, autoIncrement: true },
      merchant_id: { type: 'int' },
      amount: { type: 'decimal' },
      rate: { type: 'decimal' }, 
      status: { type: 'int' },
      creation_time: { type: 'datetime' },
      expiration_time: { type: 'datetime' }
    }),
    db.runSql('ALTER TABLE orders ALTER COLUMN amount type decimal(10,2);'),
    db.runSql('ALTER TABLE orders ALTER COLUMN rate type decimal(10,2);')
  ], callback);
};

exports.down = function(db, callback) {
  db.dropTable('orders', callback);
};
