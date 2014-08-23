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
        var cb, i, txid;
        cb = function(err, t) {
          var txid;
          r.transactions.push(t);
          if (i >= transactions.length) {
            res.write(JSON.stringify(r));
            return res.end();
          } else {
            txid = transactions[i++];
            if (parseInt(txid)) {
              txid = user + ":transactions:" + txid;
            }
            return db.hgetall(txid, cb);
          }
        };
        i = 0;
        txid = transactions[i++];
        if (parseInt(txid)) {
          txid = user + ":transactions:" + txid;
        }
        return db.hgetall(txid, cb);
      });
    },
    create: function(req, res) {
      var finish, user;
      user = req.params.user;
      finish = function() {
        res.write(JSON.stringify(req.body));
        return res.end();
      };
      db.watch(req.body.txid);
      return db.exists(req.body.txid, function(err, result) {
        var multi;
        if (result) {
          finish();
          return;
        }
        multi = db.multi();
        multi.hmset(req.body.txid, req.body);
        multi.rpush("" + user + ":transactions", req.body.txid);
        return multi.exec(function(err, replies) {
          return finish();
        });
      });
    },
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
    }
  };

}).call(this);
