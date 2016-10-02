db = require('../redis')
db.keys('user:*', (err, obj) ->
  for key in obj
    db.rename(key, key.toLowerCase()) unless key is key.toLowerCase()
)

db.keys('*:transactions', (err, obj) ->
  for key in obj
    db.rename(key, key.toLowerCase()) unless key is key.toLowerCase()
)
