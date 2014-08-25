db = require('../redis')

module.exports =
  index: (req, res) ->
    res.render('transactions/index',  
      user: req.params.user,
      layout: 'layout',
      navigation: true,
      js: (-> global.js), 
      css: (-> global.css)
    )

  json: (req, res) ->
    user = req.params.user
    r = 'transactions': []

    db.lrange("#{user}:transactions", 0, -1, (err, transactions) ->
      txid = ->
        x = transactions[i++]
        return x if typeof x != "number"
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
