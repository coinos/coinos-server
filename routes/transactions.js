(function() {
  const Promise = require('bluebird')
  const db = require('../redis')
  const moment = require('moment')
  const config = require("../config")
  const moment = require('moment')

  const txid = function(transaction, user) {
    if (transaction.match(/[a-z]/i)) {
      return transaction
    }
    return user + ":transactions:" + transaction
  }

  module.exports = {
    index: function(req, res) {
      console.log('yep')
      const result = {
        'transactions': []
      }
      const promises = []
      const pattern = req.params.user
      if (req.session.user.username === 'admin') {
        x = '*'
      }
      return db.keysAsync(pattern + ":transactions").then(function(keys) {
        return Promise.all(keys.map(function(key) {
          var user
          user = key.substr(0, key.indexOf(':'))
          return db.lrangeAsync(key, 0, -1).then(function(transactions) {
            return Promise.all(transactions.map(function(transaction) {
              return db.hgetallAsync(txid(transaction, user)).then(function(transaction) {
                if (transaction) {
                  transaction.user = user
                  return result.transactions.push(transaction)
                }
              })
            }))
          })
        }))
      }).then(function() {
        res.send(result)
      })
    },
    create: function(req, res) {
      var finish
      finish = function() {
        db.hgetall("user:" + req.params.user.toLowerCase(), function(err, user) {
          return res.render('transactions/notification', {
            layout: 'mail',
            amount: (req.body.received * req.body.exchange).toFixed(2).toString() + ' ' + user.currency,
            address: req.body.address,
            txid: req.body.txid,
            js: (function() {
              return global.js
            }),
            css: (function() {
              return global.css
            })
          }, function(err, html) {
<<<<<<< 20d24a2f4370e8171821cf15f67aa07ac55f08a2
            var content, from_email, helper, mail, request, sg, subject, to_email;
            helper = require('sendgrid').mail;
            from_email = new helper.Email('info@coinos.io');
            to_email = new helper.Email(user.email);
            subject = 'Payment Received';
            content = new helper.Content('text/html', html);
            mail = new helper.Mail(from_email, subject, to_email, content);
            sg = require('sendgrid')(process.env.SENDGRID_TOKEN);
=======
            var content, from_email, helper, mail, request, sg, subject, to_email
            helper = require('sendgrid').mail
            from_email = new helper.Email('info@coinos.io')
            to_email = new helper.Email(user.email)
            subject = 'Payment Received'
            content = new helper.Content('text/html', html)
            mail = new helper.Mail(from_email, subject, to_email, content)
            sg = require('sendgrid')(config.sendgrid_token)
>>>>>>> clean up semi-colons
            request = sg.emptyRequest({
              method: 'POST',
              path: '/v3/mail/send',
              body: mail.toJSON()
            })
            return sg.API(request, function(error, response) {
              console.log(response.statusCode)
              console.log(response.body)
              return console.log(response.headers)
            })
          })
        })
        res.write(JSON.stringify(req.body))
        return res.end()
      }
      db.watch(req.body.txid)
      return db.exists(req.body.txid, function(err, result) {
        var multi
        if (result) {
          return finish()
        }
        multi = db.multi()
        multi.hmset(req.body.txid, req.body)
        multi.rpush(req.params.user + ":transactions", req.body.txid)
        return multi.exec(function(err, replies) {
          return finish()
        })
      })
    },
    update: function(req, res) {
      return db.hset(req.params.txid, 'notes', req.body.notes, function() {
        return res.end()
      })
    },
    "delete": function(req, res) {
      return db.del(req.params.txid, function() {
        return db.lrem(req.params.user + ":transactions", 0, req.params.txid, function() {
          return res.end()
        })
      })
    }
  }

}).call(this)
