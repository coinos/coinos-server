db = require('../redis')

db.keys('user:*', (err, obj) ->
  for user, i in obj
    do (user) ->
      db.hgetall(user, (err, obj) ->
        console.log('Updating ' + user.toString())
        if obj.bip32?
          db.hset(user, 'pubkey', obj.bip32, ->)
        else
          db.hset(user, 'pubkey', obj.address, ->)
      )
)
