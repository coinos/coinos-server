db = require('../redis')
config = require("../config")
moment = require('moment') 

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
    user = req.params.user
    r = 'transactions': []

    db.lrange("#{user}:transactions", 0, -1, (err, transactions) ->
      if err or not transactions.length
        res.write(JSON.stringify(r)) 
        return res.end()
      
      txid = ->
        x = transactions[i++]
        return x if x.match(/[a-z]/i)
        return user + ":transactions:" + x

      cb = (err, t) ->
        r.transactions.push t

        if i >= transactions.length
          res.write(JSON.stringify(r))
          res.end()
        else
          db.hgetall(txid(), cb)
      
      i = 0
      db.hgetall(txid(), cb)
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
