const Passport = require("passport");
const jwt = require("passport-jwt");
const { Op } = require("sequelize");

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
      try {
        let { username } = payload;
        let user = await db.User.findOne({
          where: {
            username: { [Op.or]: [username, username.replace(/ /g, "")] }
          },
          include: { model: db.Account, as: "account" }
        });
        if (user.locked) throw new Error("account is locked");
        next(null, user);
      } catch (e) {
        if (!e.message.includes("locked")) {
          console.log(e);
          l.error("problem logging in", e);
        }
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

adminAuth = ah((req, res, next) => {
  passport.authenticate("jwt", { session: false }, function(err, user, info) {
    if (!(user && user.admin)) return res.status(401).send("Unauthorized")
    req.user = user;
    next();
  })(req, res, next);
});

app.use(passport.initialize());
