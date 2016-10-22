db = require('../redis')
bitcoin = require('bitcoinjs-lib')

db.keys('user:*', (err, keys) ->
  for key in keys
    do (key) ->
      db.hgetall(key, (err, user) ->
        address = ''
        try
          bitcoin.address.fromBase58Check(user.pubkey)
          address = user.pubkey
        catch
          try
            master = bitcoin.HDNode.fromBase58(user.pubkey)
            child = master.derive(0).derive(0)
            address = child.getAddress().toString()
          catch
            db.del(key)

        if address
          db.hmset(key, address: address)
      )
)
