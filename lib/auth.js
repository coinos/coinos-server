import fastifyPassport from "@fastify/passport";
import { g } from "$lib/db";
import config from "$config";
import jwt from "passport-jwt";

export const optional = {
  preValidation: fastifyPassport.authenticate(
    "jwt",
    { session: false },
    function (req, res, err, user, info) {
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
  if (!user || (user.pin && user.pin !== body.pin))
    throw new Error("Invalid pin");
};

export const jwtStrategy = new jwt.Strategy(
  {
    jwtFromRequest: jwt.ExtractJwt.fromExtractors([
      jwt.ExtractJwt.fromAuthHeaderAsBearerToken(),
      (req) => (req.cookies ? req.cookies.token : null),
    ]),
    secretOrKey: config.jwt,
  },
  async (payload, next) => {
    let user;
    if (payload.id) {
      user = await g(`user:${payload.id}`);
      if (typeof user === "string") user = await g(`user:${user}`);
    }

    next(null, user);
  },
);
