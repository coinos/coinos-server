db = require('../redis')
dates = []
db.keys('user:*', (err, users) ->
  for user in users
    do (user) ->
      db.lrange("#{user.split(':')[1]}:transactions", 0, -1, (err, transactions) ->
        for t in transactions
          if t.length is 64
            db.hgetall(t, (err, obj) ->
              console.log user
              console.log obj.date
            )
      )
)
