const passport = require('passport')
const db = require('./redis')
const jwt = require('passport-jwt')

passport.use(new jwt.Strategy({
    jwtFromRequest: jwt.ExtractJwt.fromAuthHeader(),
    secretOrKey: process.env.SECRET
  }, function (payload, next) {
    console.log(payload)
    db.hgetallAsync('user:' + payload.username).then((user) => {
      console.log(user)
      console.log(payload.username)
      next(null, user)
    }).catch((err) => {
      console.log(err)
      next(null, false)
    })
  })
)

module.exports = passport
