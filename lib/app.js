import config from "$config";
import fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyPassport from "@fastify/passport";
import fastifySecureSession from "@fastify/secure-session";
import cors from "@fastify/cors";

import path from "path";
import pino from "pino";

import { jwtStrategy } from "$lib/auth";
import { socketServer } from "$lib/sockets";

const app = fastify({
  logger: pino(),
  disableRequestLogging: true,
  maxParamLength: 500,
});

await app.register(import("@fastify/rate-limit"), {
  max: 50,
  timeWindow: 2000,
  keyGenerator: (req) => req.headers["cf-connecting-ip"],
});

app.register(fastifySecureSession, {
  key: Buffer.from(config.jwt, "hex"),
});

app.register(fastifyPassport.initialize());
app.register(fastifyPassport.secureSession());

fastifyPassport.use("jwt", jwtStrategy);

app.register(fastifyMultipart);

app.register(fastifyStatic, {
  root: path.join("/app/data/uploads"),
  prefix: "/public/",
});

app.register(fastifyWs, {
  errorHandler: (err, conn, req, reply) => {
    console.log("socket error", err);
    conn.destroy(err);
  },
});

await app.register(cors, {
  origin: true,
});

app.register(socketServer);

app.setErrorHandler((error, request, reply) => {
  if (error instanceof fastify.errorCodes.FST_ERR_BAD_STATUS_CODE) {
    reply.status(500).send({ ok: false });
  } else {
    reply.send(error);
  }
});

app.setNotFoundHandler((request, reply) => {
  reply.code(404).type("text/html").send("Not Found");
});

export default app;
