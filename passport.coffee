db = require("redis").createClient()
bcrypt = require('bcrypt')

passport = require('passport')
LocalStrategy = require('passport-local').Strategy

passport.serializeUser((user, done) ->
  done(null, user.username)
)

passport.deserializeUser((username, done) ->
  db.hgetall(username, (err, user) ->
    return done(null, user)
  )
)

passport.use(new LocalStrategy(
  (username, password, done) ->
    db.hget(username, 'password', (err, hash) ->
      if hash
        bcrypt.compare(password, hash, (err, match) ->
          if match
            db.hgetall(username, (err, user) ->
              return done(null, user)
            )
        )
    )
))

exports.passport = passport
