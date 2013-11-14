var dbm = require('db-migrate');
var async = require('async');
var type = dbm.dataType;

exports.up = function(db, callback) {
  async.series([db.createTable.bind(db, 'merchants', {
      user_id: { type: 'int', primaryKey: true },
      formula: { type: 'string' },
      limit: { type: 'decimal' }
    }),
    db.runSql.bind(db, 'ALTER TABLE merchants ALTER COLUMN "limit" type decimal(10,2);')
    ], callback);

};

exports.down = function(db, callback) {
  db.dropTable('merchants', callback);
};
