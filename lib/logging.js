const pino = require("pino");
const expressPino = require("express-pino-logger")({
  logger: pino("./logs/requests.log"),
  serializers: {
    res: res => {},
    req: req => ({
      method: req.method,
      url: req.url
    })
  }
});

l = {
  info: (...msgs) => pino().info(msgs.join(" ")),
  warn: (...msgs) => pino().warn(msgs.join(" ")),
  error: (...msgs) => pino().error(msgs.join(" "))
};

app.use(expressPino);
