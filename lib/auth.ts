import config from "$config";
import { fail, getUser } from "$lib/utils";
import fastifyPassport from "@fastify/passport";
import jwt from "passport-jwt";

export const admin = {
  preValidation: fastifyPassport.authenticate(
    "jwt",
    { session: false },
    (req, res, err, user, info) => {
      if (!user.admin) return res.code(401).send("unauthorized");
      req.user = user;
    },
  ),
};

export const optional = {
  preValidation: fastifyPassport.authenticate(
    "jwt",
    { session: false },
    (req, res, err, user, info) => {
      req.user = user;
    },
  ),
};

export const auth = {
  preValidation: fastifyPassport.authenticate("jwt", {
    authInfo: false,
    session: false,
  }),
};

export const requirePin = async ({ body, user }) => {
  if (!user || (user.pin && user.pin !== body.pin)) fail("Invalid pin");
};

export const jwtStrategy = new jwt.Strategy(
  {
    jwtFromRequest: jwt.ExtractJwt.fromExtractors([
      jwt.ExtractJwt.fromAuthHeaderAsBearerToken(),
      (req) => (req.cookies ? req.cookies.token : null),
    ]),
    secretOrKey: config.jwt,
    passReqToCallback: true,
  },
  async (req, payload, next) => {
    const { originalUrl: u, method: m } = req;

    let { id } = payload;
    const wl = { GET: ["/invoice", "/payments"], POST: ["/invoice"] };

    if (id.endsWith("-ro") && wl[m].some((p) => u.startsWith(p)))
      id = id.slice(0, -3);

    const user = await getUser(id);
    next(null, user);
  },
);
