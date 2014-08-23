db = require('../redis')

module.exports =
  json: (req, res) ->
    user = req.params.user
    r = 'transactions': []

    db.lrange("#{user}:transactions", 0, -1, (err, transactions) ->
      cb = (err, t) ->
        r.transactions.push t

        if i >= transactions.length
          res.write(JSON.stringify(r))
          res.end()
        else
          txid = transactions[i++]
          if parseInt(txid)
            txid = user + ":transactions:" + txid
      
          db.hgetall(txid, cb)
      
      i = 0

      txid = transactions[i++]
      if parseInt(txid)
        txid = user + ":transactions:" + txid

      db.hgetall(txid, cb)
    )

  create: (req, res) ->
    user = req.params.user
    finish = ->
      res.write(JSON.stringify(req.body))
      res.end()

    db.watch(req.body.txid)
    db.exists(req.body.txid, (err, result) ->
      if result
        finish() 
        return

      multi = db.multi()
      multi.hmset(req.body.txid, req.body)
      multi.rpush("#{user}:transactions", req.body.txid)
      multi.exec((err, replies) ->
        finish()
      )
    )

  index: (req, res) ->
    res.render('transactions/index',  
      user: req.params.user,
      layout: 'layout',
      navigation: true,
      js: (-> global.js), 
      css: (-> global.css)
    )

