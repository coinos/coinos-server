var dbm = require('db-migrate');
var type = dbm.dataType;

exports.up = function(db, callback) {
  db.createTable('merchants', {
      user_id: { type: 'int', primaryKey: true },
      formula: { type: 'string' },
      limit: { type: 'decimal' }
    }, callback);

  db.runSql('ALTER TABLE merchants ALTER COLUMN "limit" type decimal(10,2);');
};

exports.down = function(db, callback) {
  db.dropTable('merchants', callback);
};
