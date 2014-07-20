(function() {
  var db;

  db = require('../redis');

  module.exports = {
    json: function(req, res) {
      var r, user;
      user = req.params.user;
      r = {
        'transactions': []
      };
      return db.lrange("" + user + ":transactions", 0, -1, function(err, transactions) {
        var i, process;
        process = function(err, t) {
          r.transactions.push(t);
          if (i >= transactions.length) {
            res.write(JSON.stringify(r));
            return res.end();
          } else {
            return db.hgetall("" + user + ":transactions:" + transactions[i++], process);
          }
        };
        i = 0;
        return db.hgetall("" + user + ":transactions:" + transactions[i++], process);
      });
    },
    create: function(req, res) {
      var user;
      user = req.params.user;
      return db.incr('transactions', function(err, id) {
        return db.hmset("" + user + ":transactions:" + id, req.body, function() {
          return db.rpush("" + user + ":transactions", id, function() {
            res.write(JSON.stringify(req.body));
            return res.end();
          });
        });
      });
    },
    index: function(req, res) {
      return res.render('transactions/index', {
        user: req.params.user,
        layout: 'layout'
      });
    }
  };

}).call(this);
