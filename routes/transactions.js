(function() {
  var db;

  db = require('../redis');

  module.exports = {
    index: function(req, res) {
      return res.render('transactions/index', {
        user: req.params.user,
        layout: 'layout',
        navigation: true,
        js: (function() {
          return global.js;
        }),
        css: (function() {
          return global.css;
        })
      });
    },
    json: function(req, res) {
      var r, user;
      user = req.params.user;
      r = {
        'transactions': []
      };
      return db.lrange("" + user + ":transactions", 0, -1, function(err, transactions) {
        var cb, i, txid;
        if (err || !transactions.length) {
          res.write(JSON.stringify(r));
          return res.end();
        }
        txid = function() {
          var x;
          x = transactions[i++];
          if (x.match(/[a-z]/i)) {
            return x;
          }
          return user + ":transactions:" + x;
        };
        cb = function(err, t) {
          r.transactions.push(t);
          if (i >= transactions.length) {
            res.write(JSON.stringify(r));
            return res.end();
          } else {
            return db.hgetall(txid(), cb);
          }
        };
        i = 0;
        return db.hgetall(txid(), cb);
      });
    },
    create: function(req, res) {
      var finish;
      finish = function() {
        res.write(JSON.stringify(req.body));
        return res.end();
      };
      db.watch(req.body.txid);
      return db.exists(req.body.txid, function(err, result) {
        var multi;
        if (result) {
          return finish();
        }
        multi = db.multi();
        multi.hmset(req.body.txid, req.body);
        multi.rpush("" + req.params.user + ":transactions", req.body.txid);
        return multi.exec(function(err, replies) {
          return finish();
        });
      });
    },
    update: function(req, res) {
      return db.hset(req.params.txid, 'notes', req.body.notes, function() {
        return res.end();
      });
    },
    "delete": function(req, res) {
      return db.del(req.params.txid, function() {
        return db.lrem(req.params.user + ":transactions", 0, req.params.txid, function() {
          return res.end();
        });
      });
    }
  };

}).call(this);
