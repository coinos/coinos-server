var dbm = require('db-migrate');
var async = require('async');
var type = dbm.dataType;

exports.up = function(db, callback) {
  async.series([
    db.createTable.bind(db, 'settlements', {
      id: { type: 'int', primaryKey: true, autoIncrement: true },
      settler_id: { type: 'int' },
      merchant_id: { type: 'int' },
      amount: { type: 'decimal' },
      date: { type: 'datetime' },
      method: { type: 'string' }
    }),
    db.runSql.bind(db, 'ALTER TABLE settlements ALTER COLUMN amount type decimal(10,2);')
  ], callback);
};

exports.down = function(db, callback) {
  db.dropTable('settlements', callback);
};
