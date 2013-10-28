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
       )
    )
)

db.sismember("mts","mt:rest", (err,res) ->
   if !res
      db.hmset("mt:rest",{code: "rest", label: "Restaurant/Bar"}, ->
          db.sadd("mts","mt:rest")
      )	  
      db.hmset("mt:coff",{code: "rest", label: "Coffee Shop"}, ->
          db.sadd("mts","mt:coff")
      )	        
      console.log("Added merchant types")
)

process.exit()
