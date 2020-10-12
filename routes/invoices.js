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
  ah(async (req, res, next) => {
    try {
      let { invoice, user } = req.body;
      let { blindkey } = invoice;

      if (!user) ({ user } = req);
      else {
        user = await db.User.findOne({
          where: {
            username: user.username
          }
        });
      }
      if (!user) throw new Error("user not provided");
      invoice.user_id = user.id;
      invoice.account_id = user.account_id;

      l.info(
        "creating invoice",
        user.username,
        invoice.network,
        invoice.amount,
        invoice.tip,
        invoice.currency
      );

      if (invoice.network === "liquid" && !invoice.unconfidential) {
        try {
          const { username, password, port, wallet } = config.liquid;
        const { data: { result } }= await axios.post(
          `http://${username}:${password}@127.0.0.1:${port}/wallet/${wallet}`,
          {
            jsonrpc: "1.0",
            id: "curltext",
            method: "getaddressinfo",
            params: [invoice.address]
          }
        );

        invoice.unconfidential = result.unconfidential; 
        } catch(e) {
          l.error("problem getting confidential address info", e.message);
          return res.status(500).send("Problem getting confidential address");
        } 
      }

      if (!invoice.tip) invoice.tip = 0;

      const exists = await db.Invoice.findOne({
        where: {
          [Op.or]: {
            address: invoice.address || "",
            unconfidential: invoice.unconfidential || "",
            text: invoice.text
          }
        }
      });

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
