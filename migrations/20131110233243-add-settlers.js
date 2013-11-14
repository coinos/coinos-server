var dbm = require('db-migrate');
var async = require('async');
var type = dbm.dataType;

exports.up = function(db, callback) {
  async.series([
    db.createTable.bind(db, 'settlers', {
      user_id: { type: 'int', primaryKey: true },
      formula: { type: 'string' },
      reserve: { type: 'decimal' }
    }),
    db.runSql.bind(db, 'ALTER TABLE settlers ALTER COLUMN reserve type decimal(10,2);')
  ], callback);
};

exports.down = function(db, callback) {
  db.dropTable('settlers', callback);
};
