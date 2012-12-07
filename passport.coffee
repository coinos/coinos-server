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
      return done(err) if err
      if hash
        bcrypt.compare(password, hash, (err, match) ->
          if match
            db.hgetall(username, (err, user) ->
              return done(null, user)
            )
          else
            return done(null, false)
        )
      else
        return done(null, false)
    )
))

module.exports = passport
