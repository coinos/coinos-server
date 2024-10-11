import config from "$config";
import fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyPassport from "@fastify/passport";
import fastifySecureSession from "@fastify/secure-session";
import fastifyProxy from "@fastify/http-proxy";
import fastifyRateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";

import * as path from "path";
import pino from "pino";

import { jwtStrategy } from "$lib/auth";

const app = fastify({
  logger: pino(),
  disableRequestLogging: true,
  // disableRequestLogging: false,
  maxParamLength: 500,
});

app.register(fastifyRateLimit, {
  allowList: (req) => req.raw.url?.includes("public"),
  max: 100,
  timeWindow: 2000,
  keyGenerator: (req) => req.headers["cf-connecting-ip"] as string,
  errorResponseBuilder: () => {
    return {
      statusCode: 429,
      error: "Too Many Requests",
      message: "Rate limit exceeded, retry in 2 seconds",
    };
  },
});

app.register(fastifyProxy, {
  upstream: "http://localhost:3120",
  prefix: "/ws",
  rewritePrefix: "/ws",
  websocket: true
});

app.register(fastifySecureSession, {
  key: Buffer.from(config.jwt, "hex"),
});

app.register(fastifyPassport.initialize());
app.register(fastifyPassport.secureSession());

fastifyPassport.use("jwt", jwtStrategy);

app.register(fastifyMultipart, { limits: { fileSize: 10 ** 7 } });

app.register(fastifyStatic, {
  root: path.join("/home/bun/app/data/uploads"),
  prefix: "/public/",
});

await app.register(cors, { origin: true });

app.setErrorHandler((error, _, reply) => {
  if (error instanceof fastify.errorCodes.FST_ERR_BAD_STATUS_CODE) {
    reply.status(500).send({ ok: false });
  } else {
    reply.send(error);
  }
});

app.setNotFoundHandler((_, reply) =>
  reply.code(404).type("text/html").send("Not Found"),
);

export default app;
