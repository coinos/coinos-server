import config from "$config";
import { db } from "$lib/db";
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

    // Hard eviction: an account in the `evicted` set cannot authenticate AT ALL
    // — every request, every endpoint — regardless of source IP/VPN. Unlike the
    // `blacklist` freeze (which only blocks sends), this kills the value of a
    // compromised/attacker JWT outright. Match on the immutable uid OR username
    // so a rename can't shake it.
    if (
      user &&
      ((await db.sIsMember("evicted", user.id)) ||
        (await db.sIsMember("evicted", user.username?.toLowerCase?.().trim())))
    ) {
      // Distinctive, greppable line carrying the real source IP so the realtime
      // auto-banner (scripts/atk-autoban.sh) can insta-ban it at Cloudflare.
      console.error(
        `EVICTED_AUTH ${user.username} ${req.headers["cf-connecting-ip"] || req.ip}`,
      );
      return next(null, false);
    }

    next(null, user);
  },
);
