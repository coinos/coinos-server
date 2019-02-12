import passport from 'passport'
import jwt from 'passport-jwt'
import config from './config'

const l = console.log

function cookieExtractor (req) {
  if (req && req.cookies) return req.cookies['token']
  return null
}

module.exports = (db) => {
  passport.use(
    new jwt.Strategy({
      jwtFromRequest: jwt.ExtractJwt.fromExtractors([jwt.ExtractJwt.fromAuthHeaderAsBearerToken(), cookieExtractor]),
      secretOrKey: config.jwt
    }, async (payload, next) => {
      try {
        let user = await db.User.findOne({
          where: {
            username: payload.username
          } 
        })
        next(null, user)
      } catch(err) {
        l(err)
        next(null, { username: 'guest' })
      }
    })
  )

  return passport
}


