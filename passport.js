const passport = require('passport')
const jwt = require('passport-jwt')
const dotenv = require('dotenv')
dotenv.config()

require('dotenv').config()

const cookieExtractor = function(req) {
  let token = null
  if (req && req.cookies) {
    token = req.cookies['token']
  }
  return token
}

passport.use(new jwt.Strategy({
    jwtFromRequest: jwt.ExtractJwt.fromExtractors([cookieExtractor]),
    secretOrKey: process.env.SECRET
  }, async function (payload, next) {
    const db = await require('./db')
    db.User.findOne({
      where: {
        username: payload.username
      } 
    }).then((user) => {
      next(null, user)
    }).catch((err) => {
      next(null, false)
    })
  })
)

module.exports = passport
