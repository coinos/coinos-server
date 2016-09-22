(function() {
  var config, db, moment;

  db = require('../redis');

  config = require("../config");

  moment = require('moment');

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
        db.hgetall("user:" + req.params.user.toLowerCase(), function(err, user) {
          return res.render('transactions/notification', {
            layout: 'mail',
            amount: (req.body.received * req.body.exchange).toFixed(2).toString() + ' ' + user.currency,
            address: req.body.address,
            txid: req.body.txid,
            js: (function() {
              return global.js;
            }),
            css: (function() {
              return global.css;
            })
          }, function(err, html) {
            var content, from_email, helper, mail, request, sg, subject, to_email;
            helper = require('sendgrid').mail;
            from_email = new helper.Email('info@coinos.io');
            to_email = new helper.Email(user.email);
            subject = 'Transaction Sent';
            content = new helper.Content('text/html', html);
            mail = new helper.Mail(from_email, subject, to_email, content);
            sg = require('sendgrid')(config.sendgrid_token);
            request = sg.emptyRequest({
              method: 'POST',
              path: '/v3/mail/send',
              body: mail.toJSON()
            });
            return sg.API(request, function(error, response) {
              console.log(response.statusCode);
              console.log(response.body);
              return console.log(response.headers);
            });
          });
        });
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
