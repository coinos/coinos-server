import config from "$config";
import fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyPassport from "@fastify/passport";
import fastifySecureSession from "@fastify/secure-session";

import path from "path";
import pino from "pino";

import { jwtStrategy } from "$lib/auth";
import { socketServer } from "$lib/sockets";

const app = fastify({
  logger: pino(),
  disableRequestLogging: true,
  maxParamLength: 500
});

app.register(fastifySecureSession, {
  key: Buffer.from(config.jwt, "hex")
});

app.register(fastifyPassport.initialize());
app.register(fastifyPassport.secureSession());

fastifyPassport.use("jwt", jwtStrategy);

app.register(fastifyMultipart);

app.register(fastifyStatic, {
  root: path.join("/app/data/uploads"),
  prefix: "/public/"
});

app.register(fastifyWs);
app.register(socketServer);

export default app;
