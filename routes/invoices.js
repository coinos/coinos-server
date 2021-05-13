const { Op } = require("sequelize");
const axios = require("axios");

app.get(
  "/invoice",
  auth,
  ah(async (req, res, next) => {
    try {
      const invoice = await db.Invoice.findOne({
        where: {
          uuid: req.query.uuid
        }
      });

      res.send(invoice);
    } catch (e) {
      l.error("couldn't find invoice", e);
    }
  })
);

app.post(
  "/invoice",
  optionalAuth,
  ah(async (req, res, next) => {
    try {
      let { liquidAddress, invoice, user, tx } = req.body;
      let { blindkey } = invoice;

      if (liquidAddress) {
        l.info("conversion request for", liquidAddress, invoice.text);
        convert[invoice.text] = { address: liquidAddress, tx };
      }

      if (!user) ({ user } = req);
      else {
        user = await db.User.findOne({
          where: {
            username: user.username
          }
        });
      }
      if (!user) throw new Error("user not provided");
      if (!invoice.currency) invoice.currency = user.currency;
      if (!invoice.rate) invoice.rate = app.get("rates")[invoice.currency];
      if (invoice.tip > invoice.amount || invoice.tip > 1000000) throw new Error("tip is too large");
      if (invoice.tip < 0 || invoice.amount < 0) throw new Error("invalid amount");
      invoice.user_id = user.id;
      invoice.account_id = user.account_id;

      l.info(
        "creating invoice",
        user.username,
        invoice.network,
        invoice.amount,
        invoice.tip,
        invoice.currency,
        `${invoice.text.substr(0, 8)}..${invoice.text.substr(-6)}`,
      );

      if (!invoice.tip) invoice.tip = 0;

      const exists =
        invoice.text &&
        (await db.Invoice.findOne({
          where: {
            [Op.or]: {
              address: invoice.address || "",
              unconfidential: invoice.unconfidential || "",
              text: invoice.text
            }
          }
        }));

      invoice = exists
        ? await exists.update(invoice)
        : await db.Invoice.create(invoice);
      addresses[invoice.address] = user.username;
      if (invoice.unconfidential) {
        addresses[invoice.unconfidential] = user.username;
        if (blindkey) await lq.importBlindingKey(invoice.address, blindkey);
      }

      res.send(invoice);
    } catch (e) {
      l.error(e.message, e.stack);
      res.status(500).send(`Problem during invoice creation: ${e.message}`);
    }
  })
);
