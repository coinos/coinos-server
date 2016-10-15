Promise = require('bluebird')
db = require('../redis')
config = require("../config")
moment = require('moment') 

txid = (transaction, user) ->
  return transaction if transaction.match(/[a-z]/i)
  return user + ":transactions:" + transaction

module.exports =
  index: (req, res) ->
    res.render(
      'transactions/index'  
      user: req.params.user
      currency: req.session.user.currency
      layout: 'layout'
      navigation: true
      js: (-> global.js)
      css: (-> global.css)
    )

  json: (req, res) ->
    result = 'transactions': []
    promises = []
    pattern = req.params.user
    if req.session.user.username is 'admin'
      x = '*'

    db.keysAsync("#{pattern}:transactions").then((keys) ->
      Promise.all(keys.map((key) -> 
        user = key.substr(0, key.indexOf(':'))
        db.lrangeAsync(key, 0, -1).then((transactions) ->
          Promise.all(transactions.map((transaction) ->
            db.hgetallAsync(txid(transaction, user)).then((transaction) ->
              if transaction
                transaction.user = user
                result.transactions.push(transaction)
            )
          ))
        )
      ))
    ).then(->
      res.write(JSON.stringify(result))
      res.end()
    )


  create: (req, res) ->
    finish = ->
      db.hgetall("user:"+req.params.user.toLowerCase(), (err, user) ->
        res.render('transactions/notification', 
          layout: 'mail'
          amount: (req.body.received * req.body.exchange).toFixed(2).toString() + ' ' + user.currency
          address: req.body.address
          txid: req.body.txid
          js: (-> global.js)
          css: (-> global.css)
          (err, html) ->
            helper = require('sendgrid').mail
            from_email = new helper.Email('info@coinos.io')
            to_email = new helper.Email(user.email)
            subject = 'Transaction Sent'
            content = new helper.Content('text/html', html)
            mail = new helper.Mail(from_email, subject, to_email, content)

            sg = require('sendgrid')(config.sendgrid_token)
            request = sg.emptyRequest(
              method: 'POST'
              path: '/v3/mail/send'
              body: mail.toJSON()
            )

            sg.API(request, (error, response) ->
              console.log(response.statusCode)
              console.log(response.body)
              console.log(response.headers)
            )
        )
      )
      res.write(JSON.stringify(req.body))
      res.end()

    db.watch(req.body.txid)
    db.exists(req.body.txid, (err, result) ->
      return finish() if result

      multi = db.multi()
      multi.hmset(req.body.txid, req.body)
      multi.rpush("#{req.params.user}:transactions", req.body.txid)
      multi.exec((err, replies) ->
        finish()
      )
    )

  update: (req, res) ->
    db.hset(req.params.txid, 'notes', req.body.notes, ->
      res.end()
    )

  delete: (req, res) ->
    db.del(req.params.txid, ->
      db.lrem(req.params.user + ":transactions", 0, req.params.txid, ->
        res.end()
      )
    )
