var dbm = require('db-migrate');
var type = dbm.dataType;

exports.up = function(db, callback) {
  db.createTable('settlers', {
    user_id: { type: 'int', primaryKey: true },
    formula: { type: 'string' },
    reserve: { type: 'decimal' }
  }, callback);

  db.runSql('ALTER TABLE settlers ALTER COLUMN reserve type decimal(10,2);');
};

exports.down = function(db, callback) {
  db.dropTable('settlers', callback);
};
