import passport from 'passport'
import jwt from 'passport-jwt'
import dotenv from 'dotenv'
dotenv.config()

const l = console.log

function cookieExtractor (req) {
  if (req && req.cookies) return req.cookies['token']
  return null
}

module.exports = (db) => {
  passport.use(
    new jwt.Strategy({
      jwtFromRequest: jwt.ExtractJwt.fromExtractors([jwt.ExtractJwt.fromAuthHeaderAsBearerToken(), cookieExtractor]),
      secretOrKey: process.env.SECRET
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


