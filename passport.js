const passport = require('passport')
const db = require('./redis')
const jwt = require('passport-jwt')
const dotenv = require('dotenv')
dotenv.config()

const cookieExtractor = function(req) {
  let token = null
  if (req && req.cookies) {
    token = req.cookies['token']
    console.log('set')
  }
  return token
}

passport.use(new jwt.Strategy({
    jwtFromRequest: jwt.ExtractJwt.fromExtractors([cookieExtractor]),
    secretOrKey: process.env.SECRET
  }, function (payload, next) {
    db.hgetallAsync('user:' + payload.username).then((user) => {
      next(null, user)
    }).catch((err) => {
      next(null, false)
    })
  })
)

module.exports = passport
