import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import pino from "pino";

const app = new Hono();

const reqLogger = pino(pino.destination("req"));
const resLogger = pino(pino.destination("res"));

// CORS
app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    credentials: true,
  }),
);

// Static files
app.use("/public/*", serveStatic({ root: "/home/bun/app/data/uploads", rewriteRequestPath: (p) => p.replace("/public", "") }));

// Rate limiting (disabled in development)
const prod = process.env.NODE_ENV === "production";
const rateLimits = new Map<string, { count: number; reset: number }>();
const strictLimits = new Map<string, { count: number; reset: number }>();

if (prod) {
  app.use("*", async (c, next) => {
    const url = c.req.path;

    // Skip rate limiting for public assets
    if (url.includes("public")) return next();

    const ip = (c.req.header("cf-connecting-ip") as string) || (c.env as any)?.ip || "unknown";
    const ua = c.req.header("user-agent") || "unknown-ua";
    const rateLimitBy = c.req.header("rate-limit-by");
    const key = rateLimitBy === "ua" ? ua : ip;
    const now = Date.now();

    // General rate limit: 2000 req / 2s
    const gen = rateLimits.get(key);
    if (gen && now < gen.reset) {
      gen.count++;
      if (gen.count > 2000) {
        return c.json(
          { statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded, retry in 2 seconds" },
          429,
        );
      }
    } else {
      rateLimits.set(key, { count: 1, reset: now + 2000 });
    }

    // Strict rate limit for /login and /send: 10 req / 10s
    const isStrict = url.includes("/login") || url.includes("/send");
    if (isStrict) {
      const strictKey = `strict:${ua}`;
      const s = strictLimits.get(strictKey);
      if (s && now < s.reset) {
        s.count++;
        if (s.count > 10) {
          return c.json(
            { statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded" },
            429,
          );
        }
      } else {
        strictLimits.set(strictKey, { count: 1, reset: now + 10000 });
      }
    }

    return next();
  });

  // Clean up rate limit maps periodically
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateLimits) if (now >= v.reset) rateLimits.delete(k);
    for (const [k, v] of strictLimits) if (now >= v.reset) strictLimits.delete(k);
  }, 5000);
}

// Request logging
app.use("*", async (c, next) => {
  const start = Date.now();
  const url = c.req.path;

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

  const shouldLog = !ignore.some((path) => url.startsWith(path)) &&
    !(c.req.method === "GET" && url.startsWith("/users"));

  if (shouldLog) {
    const xff = c.req.header("x-forwarded-for");
    const forwardedIp = xff?.split(",")[0]?.trim();
    const ip = c.req.header("cf-connecting-ip") || forwardedIp || (c.env as any)?.ip || "unknown";

    let body;
    // Only parse body for non-GET requests
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      try {
        body = await c.req.raw.clone().json();
      } catch {}
    }

    reqLogger.info({
      method: c.req.method,
      url,
      ip,
      query: c.req.query(),
      body,
      user: (c.get("user" as never) as any)?.username,
    });
  }

  await next();

  const rawCookies = c.req.header("cookie") || "";
  const cookies: any = rawCookies.split(";").reduce((acc, cookie) => {
    const [key, value] = cookie.split("=").map((s) => s.trim());
    if (key && value) acc[key] = value;
    return acc;
  }, {});

  resLogger.info({
    url,
    statusCode: c.res.status,
    durationMs: Date.now() - start,
    username: cookies.username,
  });
});

// Error handler
app.onError((err, c) => {
  console.error("unhandled error:", c.req.method, c.req.path, err?.message || err);
  return c.json({ ok: false }, 500);
});

// Not found handler
app.notFound((c) => c.text("Not Found", 404));

export default app;
