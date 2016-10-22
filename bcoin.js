(function() {
  var bcoin, db;

  bcoin = require('bcoin');

  db = require('./redis');

  module.exports = {
    init: function() {
      var addresses, chain, pool;
      addresses = {};
      chain = new bcoin.chain({
        db: 'leveldb',
        location: __dirname + 'mainchain/mainchain.db',
        spv: true
      });
      pool = new bcoin.pool({
        chain: chain,
        spv: true
      });
      return pool.open(function(err) {
        db.keys("user:*", function(err, users) {
          return users.map(function(key) {
            return db.hgetall(key, function(err, user) {
              addresses[user.address] = user.username;
              pool.watchAddress(user.address);
              return console.log(user.address);
            });
          });
        });
        pool.connect();
        pool.startSync();
        pool.on('error', function(err) {
          debugger;
          return console.log(err);
        });
        return pool.on('tx', function(tx) {
          return console.log(tx);
        });
      });
    }
  };

}).call(this);
