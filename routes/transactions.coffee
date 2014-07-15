db = require('../redis')

module.exports =
  json: (req, res) ->
    user = req.params.user
    r = 'transactions': []

    db.lrange("#{user}:transactions", 0, -1, (err, transactions) ->
      process = (err, t) ->
        r.transactions.push t

        if i >= transactions.length
          res.write(JSON.stringify(r))
          res.end()
        else
          db.hgetall("#{user}:transactions:#{transactions[i++]}", process)
      
      i = 0
      db.hgetall("#{user}:transactions:#{transactions[i++]}", process)
    )

  create: (req, res) ->
    user = req.params.user
    db.incr('transactions', (err, id) ->
      db.hmset("#{user}:transactions:#{id}", req.body, ->
        db.rpush("#{user}:transactions", id, ->
          res.write(JSON.stringify(req.body))
          res.end()
        )
      )
    )

  index: (req, res) ->
    res.render('transactions/index',  
      user: req.params.user,
      layout: 'layout'
    )

