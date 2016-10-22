bcoin = require('bcoin')
db = require('./redis')

module.exports =
  init: ->
    addresses = {}

    chain = new bcoin.chain(
      db: 'leveldb'
      location: __dirname + 'mainchain/mainchain.db'
      spv: true
    )

    pool = new bcoin.pool(
      chain: chain
      spv: true
    )

    pool.open((err) -> 
      db.keys("user:*", (err, users) ->
        users.map((key) ->
          db.hgetall(key, (err, user) ->
            addresses[user.address] = user.username
            pool.watchAddress(user.address)
            console.log(user.address)
          )
        )
      )

      pool.connect()
      pool.startSync()

      pool.on('error', (err) -> 
        debugger
        console.log(err)
      )
      pool.on('tx', (tx) -> console.log(tx))
    )
