import app from "$app";
import db from "$db";
import Passport from "passport";
import jwt from "passport-jwt";
import { Op } from "@sequelize/core";
import fastifyPassport from "@fastify/passport";
import fastifySecureSession from '@fastify/secure-session'
import config from "$config";
import fs from "fs";
import path from "path";
import { err } from "$lib/logging";

app.register(fastifySecureSession, {
  key: config.jwt
});

app.register(fastifyPassport.initialize());
app.register(fastifyPassport.secureSession());

function cookieExtractor(req) {
  if (req && req.cookies) {
    return req.cookies["token"];
  }
  return null;
}

fastifyPassport.use(
  "jwt",
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
          err("problem logging in", e);
        }
        next(null, { username: "guest" });
      }
    }
  )
);

export const optionalAuth = {
  preValidation: fastifyPassport.authenticate(
    "jwt",
    { session: false },
    function(req, res, err, user, info) {
      req.user = user;
    }
  )
};

export const adminAuth = {
  preValidation: fastifyPassport.authenticate(
    "jwt",
    { session: false },
    function(req, res, err, user, info) {
      if (!(user && user.admin)) return res.status(401).send("Unauthorized");
      req.user = user;
    }
  )
};

export const auth = {
  preValidation: fastifyPassport.authenticate("jwt", {
    authInfo: false,
    session: false
  })
};
