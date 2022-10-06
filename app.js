import fastify from "fastify";
import pino from "pino";

export default fastify({ logger: pino(), disableRequestLogging: true, maxParamLength: 500 });
