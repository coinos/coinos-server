import app from "$app";
import db from "$db";
import config from "$config";
import store from "$lib/store";

import { auth, adminAuth, optionalAuth } from "$lib/passport";
import fs from "fs";
import { join } from "path";
import { Op } from "@sequelize/core";
import send from "./send";
import { l, warn } from "$lib/logging";
import { fail } from "$lib/utils";

import bc from "$lib/bitcoin";
import lq from "$lib/liquid";

import btcRoutes from "./bitcoin/index";
import lnRoutes from "./lightning/index";
import lqRoutes from "./liquid/index";

import "./bitcoin/receive";
import "./lightning/receive";
import "./liquid/receive";

app.post("/send", auth, send);
app.post("/sendToTokenHolders", auth, async (req, res, next) => {
  let { asset, amount } = req.body;



  let accounts = await db.Account.findAll({
    where: {
      asset,
      "$user.username$": { [Op.ne]: "gh" }
    },

    include: [{ model: db.User, as: "user" }]
  });

  let totalTokens = accounts.reduce((a, b) => a + b.balance, 0);

  let totalSats = Math.floor(amount / totalTokens);

  if (totalSats < 1) throw new Error("amount is too low to distribute");

  for (let i = 0; i < accounts.length; i++) {
    let account = accounts[i];
    console.log(account.user.username, account.balance);
  }
  accounts.map(({ balance, user: { username } }) => ({ username, balance }));

  res.send({ success: "it worked" });
});

app.get("/except", adminAuth, (req, res) => {
  let s = fs.createWriteStream("exceptions", { flags: "a" });
  store.unaccounted.map(tx => s.write(tx.txid + "\n"));
  l("updated exceptions");
  res.send("updated exceptions");
});

app.post("/lightning/parse", lnRoutes.parse);
app.post("/lightning/channel", lnRoutes.channel);
app.post("/lightning/query", auth, lnRoutes.query);
app.post("/lightning/send", auth, lnRoutes.send);

if (config.lnurl) {
  let { channelRequest } = await import("$routes/lightning/channelRequest");
  app.post("/lightning/channelRequest", channelRequest);
}

app.post("/bitcoin/broadcast", optionalAuth, btcRoutes.broadcast);
app.get("/bitcoin/generate", auth, btcRoutes.generate);
app.post("/bitcoin/sweep", auth, btcRoutes.sweep);
app.post("/bitcoin/fee", auth, btcRoutes.fee);
app.post("/bitcoin/send", auth, btcRoutes.send);

setTimeout(async () => {
  try {
    const address = await bc.getNewAddress();
    const { hdkeypath } = await bc.getAddressInfo(address);
    const parts = hdkeypath.split("/");
    store.bcAddressIndex = parts[parts.length - 1].replace("'", "");
  } catch (e) {
    console.error(e);
  }
}, 50);

app.post("/liquid/broadcast", optionalAuth, lqRoutes.broadcast);
app.get("/liquid/generate", auth, lqRoutes.generate);
app.post("/liquid/fee", auth, lqRoutes.fee);
app.post("/liquid/send", auth, lqRoutes.send);

setTimeout(async () => {
  try {
    const address = await lq.getNewAddress();
    const { hdkeypath } = await lq.getAddressInfo(address);
    const parts = hdkeypath.split("/");
    store.lqAddressIndex = parts[parts.length - 1].slice(0, -1);
  } catch (e) {
    warn("Problem getting liquid address index", e.message);
  }
}, 50);

app.get("/payments", auth, async (req, res) => {
  if (!req.user.account_id) return res.send([]);
  let payments = await db.Payment.findAll({
    where: {
      account_id: req.user.account_id
    },
    order: [["id", "DESC"]],
    include: {
      model: db.Account,
      as: "account"
    }
  });

  res.send(payments);
});

app.get("/payment/:redeemcode", async (req, res) => {
  try {
    const { redeemcode } = req.params;
    let payment = await db.Payment.findOne({
      where: {
        redeemcode
      },
      include: {
        model: db.Account,
        as: "account"
      }
    });

    if (!payment) fail("invalid code");

    res.send(payment);
  } catch (e) {
    res.code(500).send(e.message);
  }
});
