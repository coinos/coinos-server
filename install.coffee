db = require("./redis")
bcrypt = require('bcrypt')

db.get("user:admin", (err, res) ->
  if !res
    bcrypt.hash('admin', 12, (err, hash) ->
       db.sadd("users","user:admin")
       db.hmset("user:admin",
         username: 'admin'
         password: hash,
        , ->
          console.log("Created admin user with password 'admin'")
          process.exit()
       )
    )
)
