const passport = require("passport");
const jwt = require("passport-jwt");
const config = require("./config");

const l = require("pino")();

function cookieExtractor(req) {
  if (req && req.cookies) return req.cookies["token"];
  return null;
}

module.exports = db => {
  passport.use(
    new jwt.Strategy(
      {
        jwtFromRequest: jwt.ExtractJwt.fromExtractors([
          jwt.ExtractJwt.fromAuthHeaderAsBearerToken(),
          cookieExtractor
        ]),
        secretOrKey: config.jwt
      },
      async (payload, next) => {
        try {
          let user = await db.User.findOne({
            where: {
              username: payload.username
            }
          });
          next(null, user);
        } catch (e) {
          l.error("error finding user for session", e);
          next(null, { username: "guest" });
        }
      }
    )
  );

  return passport;
};
