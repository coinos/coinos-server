var dbm = require('db-migrate');
var type = dbm.dataType;

exports.up = function(db, callback) {
  db.createTable('settlements', {
      id: { type: 'int', primaryKey: true, autoIncrement: true },
      settler_id: { type: 'int' },
      merchant_id: { type: 'int' },
      amount: { type: 'decimal' },
      date: { type: 'datetime' },
      method: { type: 'string' }
    }, callback);

  db.runSql('ALTER TABLE settlements ALTER COLUMN amount type decimal(10,2);');
};

exports.down = function(db, callback) {
  db.dropTable('settlements', callback);
};
