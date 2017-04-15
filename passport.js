const passport = require('passport')
const jwt = require('passport-jwt')

passport.use(new jwt.Strategy({
    jwtFromRequest: jwt.ExtractJwt.fromAuthHeader(),
    secretOrKey: process.env.SECRET
  }, (payload, next) => {
    const user = {} // todo 
    if (user) {
      next(null, user)
    } else {
      next(null, false)
    }
  })
)

module.exports = passport
