const axios = require("axios");
const lnurl = require("lnurl");
const jwt = require("jsonwebtoken");
const qs = require("query-string");

logins = {};
recipients = {};
payments = {};
withdrawals = {};

lnurlServer = lnurl.createServer(config.lnurl);

var optionalAuth = function (req, res, next) {
  passport.authenticate("jwt", { session: false }, function (err, user, info) {
    req.user = user;
    next();
  })(req, res, next);
};

app.get(
  "/url",
  ah(async (req, res, next) => {
    try {
      const code = await db.Code.findOne({
        where: {
          code: req.query.code,
        },
      });

      if (code) {
        res.send(code.text);
      } else {
        throw new Error("code not found");
      }
    } catch (e) {
      l.error("couldn't find url", e.message);
    }
  })
);

app.get(
  "/withdraw",
  auth,
  ah(async (req, res, next) => {
    const { min, max } = req.query;
    try {
      const result = await lnurlServer.generateNewUrl("withdrawRequest", {
        minWithdrawable: min * 1000,
        maxWithdrawable: max * 1000,
        defaultDescription: "coinos voucher",
      });

      withdrawals[result.secret] = req.user;

      res.send(result);
    } catch (e) {
      l.error("problem generating withdrawl url", e.message);
      res.status(500).send(e.message);
    }
  })
);

app.post(
  "/code",
  ah(async (req, res, next) => {
    try {
      const { encoded } = req.body.lnurl;
      const code = await db.Code.findOrCreate({
        where: {
          code: `lnurl:${encoded.substr(-32)}`,
          text: encoded,
        },
      });

      res.send(code);
    } catch (e) {
      l.error(e.errors);
      res.status(500).send(e.message);
    }
  })
);

app.post(
  "/withdraw",
  auth,
  ah(async (req, res, next) => {
    const { user } = req;
    const {
      amount: value,
      params: { callback, k1 },
    } = req.body;
    const invoice = await lna.addInvoice({ value });
    const { payment_request: pr } = invoice;
    const url = `${callback}?k1=${k1}&pr=${pr}`;

    await db.Invoice.create({
      user_id: user.id,
      text: pr,
      rate: app.get("rates")[user.currency],
      currency: user.currency,
      amount: value,
      tip: 0,
      network: "bitcoin",
    });

    try {
      result = (await axios.get(url)).data;
      res.send(result);
    } catch (e) {
      l.error("failed to withdraw", e.message);
      res.status(500).send(e.message);
    }
  })
);

app.get(
  "/pay/:username",
  ah(async (req, res, next) => {
    const { username } = req.params;
    let user = await db.User.findOne({
      where: {
        username,
      },
    });

    let { amount, minSendable, maxSendable } = req.query;
    minSendable = minSendable || 1000;
    maxSendable = maxSendable || 1000000000;
    if (parseInt(amount)) minSendable = maxSendable = amount * 1000;

    let invoices = await db.Invoice.findAll({
      where: {
        amount,
      },
      order: [["id", "DESC"]],
      limit: 1,
    });

    if (invoices.length) await invoices[0].destroy();

    try {
      const result = await lnurlServer.generateNewUrl("payRequest", {
        minSendable,
        maxSendable,
        metadata: JSON.stringify([["text/plain", `paying ${user.username}`]]),
      });

      recipients[result.secret] = user;
      l.info("recipient", user.username, result.secret);
      res.send(result);
    } catch (e) {
      l.error("problem generating payment url", e.message);
      res.status(500).send(e.message);
    }
  })
);

app.post(
  "/pay",
  auth,
  ah(async (req, res, next) => {
    const { user } = req;
    const {
      amount,
      params: { callback, k1 },
    } = req.body;

    const url = `${callback}?amount=${amount * 1000}`;

    try {
      const parts = callback.split("/");
      const secret = parts[parts.length - 1];
      payments[secret] = user;

      const result = (await axios.get(url)).data;
      res.send(await send(amount, "", result.pr, user));
    } catch (e) {
      l.error("failed to send payment", e.message);
      throw e;
      res.status(500).send(e.message);
    }
  })
);

app.get(
  "/login",
  optionalAuth,
  ah(async (req, res, next) => {
    try {
      const result = await lnurlServer.generateNewUrl("login");

      if (req.user) {
        logins[result.secret] = req.user.username;
      }

      res.send(result);
    } catch (e) {
      l.error("problem generating login url", e.message);
      res.status(500).send(e.message);
    }
  })
);

app.get(
  "/decode",
  ah(async (req, res, next) => {
    const { text } = req.query;

    try {
      const url = lnurl.decode(text);
      let spl = url.split("?");
      if (spl.length > 1 && qs.parse(spl[1]).tag === "login") {
        return res.send({
          tag: "login",
          k1: qs.parse(spl[1]).k1,
          callback: url,
          domain: url
            .split("://")[1]
            .split("/")[0]
            .split("@")
            .slice(-1)[0]
            .split(":")[0],
        });
      }

      const { data: params } = await axios.get(url);
      res.send(params);
    } catch (e) {
      l.error("problem decoding lnurl", e.message);
      res.status(500).send(e.message);
    }
  })
);

lnurlServer.bindToHook(
  "middleware:signedLnurl:afterCheckSignature",
  async (req, res, next) => {
    let user;
    const { amount: msats, key, tag, pr, k1 } = req.query;

    if (msats) {
      amount = Math.round(msats / 1000);
      const parts = req.originalUrl.split("/");
      const secret = parts[parts.length - 1].split("?")[0];
      user = payments[secret];

      if (user) {
        let account = await db.Account.findOne({
          where: {
            user_id: user.id,
            asset: config.liquid.btcasset,
          },
        });

        if (account.balance < amount) {
          throw new Error("Insufficient funds");
        }
      }

      const recipient = recipients[secret];

      if (recipient) {
        setTimeout(async () => {
          let { invoices } = await lna.listInvoices({
            pending_only: true,
          });

          if (invoices.length) {
            let invoice = await db.Invoice.create({
              user_id: recipient.id,
              text: invoices[invoices.length - 1].payment_request,
              rate: app.get("rates")[recipient.currency],
              currency: recipient.currency,
              amount,
              tip: 0,
              network: "bitcoin",
            });
            l.info("invoice created", invoice.text, invoice.amount);
          }
        }, 100);
      }
    }

    if (tag === "login") {
      let username = logins[k1];

      if (!username) {
        const keyObj = await db.Key.findOne({
          where: { hex: key },
          include: [
            {
              model: db.User,
              as: "user",
            },
          ],
        });

        if (keyObj) ({ user } = keyObj);

        if (!user) {
          let ip =
            req.headers["x-forwarded-for"] || req.connection.remoteAddress;
          user = await register(
            {
              username: key.substr(0, 8),
              password: key,
            },
            ip
          );
        }

        ({ username } = user);
      }

      logins[key] = { k1, username };
    }

    if (pr) {
      user = withdrawals[k1];
      if (!user) {
        if (next) next(new Error("withdrawal not found"));
        return;
      }

      try {
        let decoded = await lna.decodePayReq({ pay_req: pr });
        let amount = decoded.num_satoshis;

        await db.transaction(async (transaction) => {
          let account = await db.Account.findOne({
            where: {
              user_id: user.id,
              asset: config.liquid.btcasset,
            },
            lock: transaction.LOCK.UPDATE,
            transaction,
          });

          if (account.balance < amount) {
            throw new Error("Insufficient funds");
          }

          let payment = await db.Payment.create(
            {
              amount: -amount,
              account_id: account.id,
              user_id: user.id,
              hash: pr,
              rate: app.get("rates")[user.currency],
              currency: user.currency,
              confirmed: true,
              network: "lightning",
            },
            { transaction }
          );

          setTimeout(async () => {
            try {
              let { payments } = await lna.listPayments({
                include_incomplete: false,
                max_payments: 5,
                reversed: true,
              });

              let p = payments.find((p) => p.payment_request === pr);
              if (p) {
                l.info("found payment", pr);
                payment.fee = p.fee;
                account.balance -= p.fee;
                await account.save();
                await payment.save();
                payment = payment.get({ plain: true });
                payment.account = account.get({ plain: true });
                emit(user.username, "account", account);
                emit(user.username, "payment", payment);
              } else {
                l.warn("payment not found, fee not set", pr);
              }
            } catch (e) {
              l.error("problem trying to get ln withdrawal payment", e);
            }
          }, 1000);

          account.balance -= amount;
          await account.save({ transaction });

          let p = payment.get({ plain: true });
          p.account = account.get({ plain: true });

          emit(user.username, "account", p.account);
          emit(user.username, "payment", p);
        });
      } catch (e) {
        l.error("failed to process withdrawal", e.message);
        return next(e);
      }
    }

    if (next) next(req, res);
  }
);

lnurlServer.bindToHook("login", async (key) => {
  try {
    if (!key) throw new Error("login key not defined");

    const exists = await db.Key.findOne({
      where: { hex: key },
      include: [{ model: db.User, as: "user" }],
    });

    let user;
    if (logins[key] && logins[key] !== "undefined") {
      const { username } = logins[key];
      user = await db.User.findOne({
        where: { username },
      });

      if (user) {
        const [k, created] = await db.Key.findOrCreate({
          where: {
            user_id: user.id,
            hex: key,
          },
        });

        if (created) {
          l.info("added key", username, k);
          emit(username, "key", k);
        }
      } else {
        l.info("user not found");
        user = await register({
          username: key.substr(0, 8),
          password: key,
        });
      }
    } else if (exists) ({ user } = exists);

    if (user && user.username) {
      const payload = { username: user.username };
      const token = jwt.sign(payload, config.jwt);
      const ws = sessions[logins[key].k1];
      if (ws && ws.send)
        ws.send(JSON.stringify({ type: "token", data: { token, key } }));
    }
  } catch (e) {
    l.error("problem with login hook", e.message);
  }
});
