import config from "$config";
import cors from "@fastify/cors";
import fastifyProxy from "@fastify/http-proxy";
import fastifyMultipart from "@fastify/multipart";
import fastifyPassport from "@fastify/passport";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifySecureSession from "@fastify/secure-session";
import fastifyStatic from "@fastify/static";
import fastify from "fastify";
import pino from "pino";

import * as path from "path";

import { jwtStrategy } from "$lib/auth";

const app = fastify({
  logger: true,
  disableRequestLogging: true,
  routerOptions: { maxParamLength: 500 },
});

const reqLogger = pino(pino.destination("req"));
const resLogger = pino(pino.destination("res"));

// app.addHook("onRequest", async (req) => {
//   reqLogger.info({ url: req.raw.url, id: req.id });
// });
//

app.addHook("preHandler", async (req) => {
  const url = req.raw.url;
  const ignore = [
    "/ws",
    "/me",
    "/confirm",
    "/public",
    "/rates",
    "/challenge",
    "/rate",
    "/lnurlp",
    "/subscriptions",
    "/accounts",
    "/contacts",
  ];
  if (ignore.some((path) => url.startsWith(path))) return;
  if (req.method === "GET" && url.startsWith("/users")) return;

  const xff = req.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(xff) ? xff[0] : xff?.split(",")[0]?.trim();
  const ip = req.headers["cf-connecting-ip"] || forwardedIp || req.ip;

  reqLogger.info({
    method: req.method,
    url,
    ip,
    headers: req.headers,
    query: req.query,
    body: req.body,
    user: (req.user as any)?.username,
    id: req.id,
  });
});

app.addHook("onResponse", async (req, reply) => {
  const rawCookies = req.raw.headers.cookie || "";

  const cookies: any = rawCookies.split(";").reduce((acc, cookie) => {
    const [key, value] = cookie.split("=").map((s) => s.trim());
    if (key && value) acc[key] = value;
    return acc;
  }, {});

  resLogger.info({
    id: req.id,
    url: req.raw.url,
    statusCode: reply.raw.statusCode,
    durationMs: reply.elapsedTime,
    username: cookies.username,
  });
});

app.register(fastifyRateLimit, {
  allowList: (req) => req.raw.url?.includes("public"),
  max: 2000,
  timeWindow: 2000,
  keyGenerator: (req) => {
    const ip = (req.headers["cf-connecting-ip"] as string) || req.ip;
    const ua = req.headers["user-agent"] || "unknown-ua";
    return req.headers["rate-limit-by"] === "ua" ? ua : ip;
  },
  errorResponseBuilder: () => {
    return {
      statusCode: 429,
      error: "Too Many Requests",
      message: "Rate limit exceeded, retry in 2 seconds",
    };
  },
});

app.register(fastifyRateLimit, {
  allowList: (req) => {
    const url = req.raw.url || "";
    const matches = url.includes("/login") || url.includes("/send");
    return !matches;
  },
  max: 10,
  timeWindow: 10000,
  keyGenerator: (req) => (req.headers["user-agent"] as string) || "unknown-ua",
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: "Too Many Requests",
    message: "Rate limit exceeded",
  }),
});

app.register(fastifyProxy, {
  upstream: "http://localhost:3120",
  prefix: "/ws",
  rewritePrefix: "/ws",
  websocket: true,
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

await app.register(cors, {
  origin: true,
  credentials: true,
});

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
