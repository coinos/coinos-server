import app from "$app";
import db from "$db";
import store from "$lib/store";
import { optionalAuth } from "$lib/passport";
import { Op } from "@sequelize/core";
import axios from "axios";
import { err, l } from "$lib/logging";
import bc from "$lib/bitcoin";
import lq from "$lib/liquid";
import { SATS, bip21, deriveAddress, derivePayRequest } from "$lib/utils";

app.get("/invoice", async (req, res, next) => {
  try {
    const invoice = await db.Invoice.findOne({
      where: {
        uuid: req.query.uuid
      },
      include: {
        model: db.User,
        as: "user",
        attributes: ["username", "currency"]
      }
    });

    res.send(invoice);
  } catch (e) {
    err("invoice not found", e);
    res.code(500).send("Invoice not found");
  }
});

app.get("/invoice/:text", async (req, res, next) => {
  try {
    let { text } = req.params;
    let where =
      text.split("-").length > 4
        ? { uuid: text }
        : text.startsWith("ln")
        ? { text }
        : {
            [Op.or]: [{ unconfidential: text }, { address: text }]
          };

    const invoice = await db.Invoice.findOne({
      where,
      include: {
        model: db.User,
        as: "user",
        attributes: ["username", "currency"]
      }
    });

    res.send(invoice);
  } catch (e) {
    err("invoice not found", e);
    res.code(500).send("Invoice not found");
  }
});

app.post("/invoice", optionalAuth, async (req, res, next) => {
  try {
    let { type = "bech32", liquidAddress, id, invoice, user, tx } = req.body;
    let { blindkey, currency, tip, amount, rate, network } = invoice;
    let address, unconfidential, text;

    if (amount < 0) throw new Error("amount out of range");
    if (tip > amount || tip > 1000000 || tip < 0)
      throw new Error("tip amount out of range");

    if (!user) ({ user } = req);
    else {
      user = await db.User.findOne({
        where: {
          username: user.username
        },
        include: {
          model: db.Account,
          as: "account"
        }
      });
    }
    if (!user) throw new Error("user not provided");
    if (!currency) currency = user.currency;
    if (!rate) rate = store.rates[currency];
    if (tip > amount || tip > 1000000) throw new Error("tip is too large");
    if (tip < 0 || amount < 0) throw new Error("invalid amount");

    if (user.account.pubkey) {
      let { address, confidentialAddress } = await deriveAddress(
        user.account,
        type
      );
      if (confidentialAddress) {
        address = confidentialAddress;
        unconfidential = address;
      } else {
        address = address;
      }
    } else if (network !== "lightning") {
      address = await { bitcoin: bc, liquid: lq }[network].getNewAddress();
      if (network === "liquid")
        ({ unconfidential } = await lq.getAddressInfo(address));
    }

    invoice = {
      ...invoice,
      account_id: user.account.id,
      address,
      amount,
      currency,
      rate,
      tip,
      unconfidential,
      user_id: user.id
    };

    if (network === "lightning") {
      invoice.text = await derivePayRequest(invoice);
    } else {
      invoice.text = bip21(invoice, user.account);
    }

    if (liquidAddress) {
      l("conversion request for", liquidAddress, invoice.text);
      store.convert[invoice.text] = { address: liquidAddress, tx };
    }

    l(
      "creating invoice",
      user.username,
      invoice.network,
      invoice.amount,
      invoice.tip,
      invoice.currency,
      invoice.text && `${invoice.text.substr(0, 8)}..${invoice.text.substr(-6)}`
    );

    if (!invoice.tip) invoice.tip = 0;

    invoice = await db.Invoice.create(invoice);
    store.addresses[invoice.address] = user.username;
    if (invoice.unconfidential) {
      store.addresses[invoice.unconfidential] = user.username;
      if (blindkey) await lq.importBlindingKey(invoice.address, blindkey);
    }

    res.send(invoice);
  } catch (e) {
    err(e.message, e.stack);
    res.code(500).send(`Problem during invoice creation: ${e.message}`);
  }
});

app.post(
  "/:username/:network/invoice",
  optionalAuth,
  async (req, res, next) => {
    let { network, username } = req.params;
  }
);
