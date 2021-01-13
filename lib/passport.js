const Passport = require("passport");
const jwt = require("passport-jwt");

function cookieExtractor(req) {
  if (req && req.cookies) {
    return req.cookies["token"];
  }
  return null;
}

passport = Passport.use(
  new jwt.Strategy(
    {
      jwtFromRequest: jwt.ExtractJwt.fromExtractors([
        jwt.ExtractJwt.fromAuthHeaderAsBearerToken(),
        cookieExtractor
      ]),
      secretOrKey: config.jwt
    },
    async (payload, next) => {
      const { username } = payload;
      try {
        let user = await db.User.findOne({
          where: { username },
          include: { model: db.Account, as: "account" }
        });
        if (user.locked) throw new Error("account is locked");
        next(null, user);
      } catch (e) {
        l.error("problem logging in", e);
        next(null, { username: "guest" });
      }
    }
  )
);

auth = passport.authenticate("jwt", { session: false });

optionalAuth = function(req, res, next) {
  passport.authenticate("jwt", { session: false }, function(err, user, info) {
    req.user = user;
    next();
  })(req, res, next);
};

app.use(passport.initialize());
