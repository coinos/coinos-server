const axios = require("axios");
const lnurl = require("lnurl");
const jwt = require("jsonwebtoken");
const qs = require("query-string");
const persist = require("../lib/persist");
const bolt11 = require("bolt11");

logins = persist("data/logins.json");
recipients = persist("data/recipients.json");
lnurlPayments = persist("data/payments.json");
withdrawals = persist("data/withdrawals.json");

lnurlServer = lnurl.createServer(config.lnurl);

let { computeConversionFee, conversionFeeReceiver } = require('./lightning/conversionFee.js');

var optionalAuth = function(req, res, next) {
  passport.authenticate("jwt", { session: false }, function(err, user, info) {
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
          code: req.query.code
        }
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
        defaultDescription: "coinos voucher"
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
          text: encoded
        }
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
      params: { callback, k1 }
    } = req.body;
    const invoice = await lnp.addInvoice({ value });
    const { payment_request: pr } = invoice;
    const url = `${callback}?k1=${k1}&pr=${pr}`;

    await db.Invoice.create({
      user_id: user.id,
      text: pr,
      rate: app.get("rates")[user.currency],
      currency: user.currency,
      amount: value,
      tip: 0,
      network: "bitcoin"
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
  "/lnurlp/:username",
  ah(async (req, res, next) => {
    try {
      const { username } = req.params;
      let user = await db.User.findOne({
        where: {
          username
        }
      });

      if (!user) throw new Error("user not found");

      let { amount, minSendable, maxSendable } = req.query;
      minSendable = minSendable || 1000;
      maxSendable = maxSendable || 1000000000;
      if (parseInt(amount)) minSendable = maxSendable = amount * 1000;

      let result = await lnurlServer.generateNewUrl("payRequest", {
        minSendable,
        maxSendable,
        metadata: JSON.stringify([["text/plain", `paying ${user.username}`]])
      });

      recipients[result.secret] = user;
      l.info("recipient", user.username, result.secret);

      result = await axios.get(result.url);

      res.send(result.data);
    } catch (e) {
      l.error("problem generating payment url", e.message);
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
        username
      }
    });

    let { amount, minSendable, maxSendable } = req.query;
    minSendable = minSendable || 1000;
    maxSendable = maxSendable || 1000000000;
    if (parseInt(amount)) minSendable = maxSendable = amount * 1000;

    try {
      const result = await lnurlServer.generateNewUrl("payRequest", {
        minSendable,
        maxSendable,
        metadata: JSON.stringify([["text/plain", `paying ${user.username}`]])
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
      comment,
      params: { callback, k1 }
    } = req.body;

    let url = `${callback}${callback.includes("?") ? "&" : "?"}amount=${amount *
      1000}${comment ? "&comment=" + comment : ""}`;

    try {
      const parts = callback.split("/");
      const secret = parts[parts.length - 1];
      lnurlPayments[secret] = user.id;

      if (recipients[secret]) {
        url = `${req.protocol}://${req.get("host")}/api/send`;
        const { data } = await axios.post(
          url,
          {
            amount,
            memo: comment,
            username: recipients[secret].username
          },
          {
            headers: {
              Authorization: req.get("Authorization")
            }
          }
        );

        res.send(data);
      } else {
        const { data } = await axios.get(url);
        res.send(await send(amount, "", data.pr, user));
      }
    } catch (e) {
      l.error("failed to send payment", e.message);
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
  "/encode",
  ah(async (req, res, next) => {
    let { domain, name } = req.query;
    let url = `https://${domain}/.well-known/lnurlp/${name}`;
    res.send(lnurl.encode(url));
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
            .split(":")[0]
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

lnurlServer.on("payRequest:action:processed", async function(event) {
  const { secret, params, result } = event;
  const { id, invoice } = result;
  const recipient = recipients[secret];
  let payreq = bolt11.decode(invoice);

  try {
    let i = await db.Invoice.create({
      user_id: recipient.id,
      text: invoice,
      rate: app.get("rates")[recipient.currency],
      currency: recipient.currency,
      amount: payreq.satoshis,
      tip: 0,
      network: "lightning"
    });

    l.info("invoice created", i.text, i.amount);
  } catch (e) {
    l.error("problem finding lnurl invoice", e.message);
  }
});

lnurlServer.bindToHook(
  "middleware:signedLnurl:afterCheckSignature",
  async (req, res, next) => {
    try {
      let user;
      const { amount: msats, key, tag, pr, k1 } = req.query;

      if (msats) {
        amount = Math.round(msats / 1000);
        const parts = req.originalUrl.split("/");
        const secret = parts[parts.length - 1].split("?")[0];
        let user_id = lnurlPayments[secret];

        if (user_id) {
          let account = await db.Account.findOne({
            where: {
              user_id,
              asset: config.liquid.btcasset,
              pubkey: null
            }
          });

          if (account.balance < amount) {
            throw new Error("Insufficient funds");
          }
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
                as: "user"
              }
            ]
          });

          if (keyObj) ({ user } = keyObj);

          if (!user) {
            let ip =
              req.headers["x-forwarded-for"] || req.connection.remoteAddress;

            let username = `satoshi-${key.substr(0, 12)}`;
            let existing = await db.User.findOne({ where: { username } });
            if (existing) user = existing;
            else {
              user = await register(
                {
                  username,
                  password: key
                },
                ip
              );
            }
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
          let decoded = await lnp.decodePayReq({ pay_req: pr });
          let amount = decoded.num_satoshis;
          let conversionFee = computeConversionFee(amount);

          await db.transaction(async transaction => {
            let account = await db.Account.findOne({
              where: {
                user_id: user.id,
                asset: config.liquid.btcasset
              },
              lock: transaction.LOCK.UPDATE,
              transaction
            });

            // account that receives conversion fees
            let receiverAccount = await db.Account.findOne({
              where: {
                "$user.username$": conversionFeeReceiver
              },
              include: [
                {
                  model: db.User,
                  as: "user"
                },
              ],
              lock: transaction.LOCK.UPDATE,
              transaction
            });

            let conversionFeeDeduction = Math.min(account.lightning_credits, conversionFee);
            if (conversionFeeDeduction) {
              await account.decrement({ lightning_credits: conversionFeeDeduction }, { transaction });
              await account.reload({ transaction });
              conversionFee -= conversionFeeDeduction;
            }

            if (account.balance < amount) {
              throw new Error("Insufficient funds");
            } else if (account.balance < amount + conversionFee) {
              throw new Error("Insufficient funds for conversion fee");
            }

            let fee_payment_id = null;
            if (conversionFee) {
              await receiverAccount.increment({ balance: conversionFee }, { transaction });
              await receiverAccount.reload({ transaction });
              let fee_payment = await db.Payment.create({
                amount: conversionFee,
                fee: 0,
                memo: "Bitcoin conversion fee",
                account_id: receiverAccount.id,
                user_id: receiverAccount.user_id,
                rate: app.get("rates")[receiverAccount.user.currency],
                currency: receiverAccount.user.currency,
                confirmed: true,
                received: true,
                network: "COINOS"
              }, { transaction });
              fee_payment_id = fee_payment.id;
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
                fee_payment_id,
              },
              { transaction }
            );

            setTimeout(async () => {
              try {
                let { payments } = await lnp.listPayments({
                  include_incomplete: false,
                  max_payments: 5,
                  reversed: true
                });

                let p = payments.find(p => p.payment_request === pr);
                if (p) {
                  l.info("found payment", pr);
                  payment.fee = p.fee;
                  await account.decrement({ balance: p.fee }, { transaction });
                  await account.reload({ transaction });
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

            await account.decrement({ balance: (amount + conversionFee) }, { transaction });
            await account.reload({ transaction });

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
    } catch (e) {
      l.error("unhandled lnurl error", e.message);
    }
  }
);

lnurlServer.bindToHook("login", async key => {
  try {
    if (!key) throw new Error("login key not defined");

    const exists = await db.Key.findOne({
      where: { hex: key },
      include: [{ model: db.User, as: "user" }]
    });

    let user;
    if (logins[key] && logins[key] !== "undefined") {
      const { username } = logins[key];
      user = await db.User.findOne({
        where: { username }
      });

      if (user) {
        const [k, created] = await db.Key.findOrCreate({
          where: {
            user_id: user.id,
            hex: key
          }
        });

        if (created) {
          l.info("added key", username, k);
          emit(username, "key", k);
        }
      } else {
        l.info("user not found");
        user = await register({
          username: key.substr(0, 8),
          password: key
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
