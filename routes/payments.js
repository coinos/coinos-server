import app from "$app";
import db from "$db";
import config from "$config";
import store from "$lib/store";
import getAccount from "$lib/account";

import { auth, adminAuth, optionalAuth } from "$lib/passport";
import fs from "fs";
import { join } from "path";
import { Op } from "@sequelize/core";
import send from "./send";
import { err, l, warn } from "$lib/logging";
import { fail } from "$lib/utils";
import { emit } from "$lib/sockets";

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
  let { start, end, limit, offset, v2 } = req.query;

  if (limit) limit = parseInt(limit);
  if (offset) offset = parseInt(offset);

  let where = {
    account_id: req.user.account_id
  };

  if (start || end) where.createdAt = {};
  if (start) where.createdAt[Op.gte] = new Date(parseInt(start));
  if (end) where.createdAt[Op.lte] = new Date(parseInt(end));

  if (!req.user.account_id) return res.send([]);

  let total = await db.Payment.count({ where });

  let payments = await db.Payment.findAll({
    where,
    order: [["id", "DESC"]],
    include: {
      model: db.Account,
      as: "account"
    },
    include: {
      attributes: ["username", "profile", "uuid"],
      model: db.User,
      as: "with"
    },
    limit,
    offset
  });

  if (v2) {
    res.send({ transactions: payments, total });
  } else {
    res.send(payments);
  }
});

app.get("/voucher/:redeemcode", async (req, res) => {
  try {
    const { redeemcode } = req.params;
    let payment = await db.Payment.findOne({
      where: {
        redeemcode
      },
      include: { all: true }
    });

    payment = payment.get({ plain: true });
    payment.redeemer = payment["with"];

    if (!payment) fail("invalid code");

    res.send(payment);
  } catch (e) {
    res.code(500).send(e.message);
  }
});

let redeeming = {};
app.post("/redeem", optionalAuth, async function(req, res) {
  const { redeemcode } = req.body;
  try {
    await db.transaction(async transaction => {
      if (redeeming[redeemcode]) fail("redemption in progress");
      redeeming[redeemcode] = true;
      if (!redeemcode) fail("no code provided");

      let { user } = req;

      const source = await db.Payment.findOne({
        where: {
          redeemcode: req.body.redeemcode
        },
        include: {
          model: db.Account,
          as: "account"
        },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      l("redeeming", redeemcode);

      if (!source) fail("Invalid code");
      if (source.redeemed) fail("Voucher has already been redeemed");
      let { amount } = source;
      amount = -amount;

      if (!user) {
        const ip =
          req.headers["x-forwarded-for"] || req.connection.remoteAddress;

        user = await register(
          {
            username: redeemcode.substr(0, 8),
            password: ""
          },
          ip,
          false
        );

        let payload = { username: user.username };
        let token = jwt.sign(payload, config.jwt);
        res.cookie("token", token, {
          expires: new Date(Date.now() + 432000000)
        });

        delete redeeming[redeemcode];
        return res.send({ user });
      }

      let account = await getAccount(source.account.asset, user, transaction);
      let { hash, memo, confirmed, fee, network } = source;

      source.redeemed = true;
      (source.with_id = user.id), await source.save({ transaction });

      let payment = await db.Payment.create(
        {
          amount,
          account_id: account.id,
          user_id: user.id,
          hash: "Voucher " + redeemcode,
          memo,
          rate: store.rates[user.currency],
          currency: user.currency,
          confirmed,
          network,
          received: true,
          fee,
          with_id: source.user_id
        },
        { transaction }
      );

      await account.increment({ balance: amount }, { transaction });
      await account.reload({ transaction });

      payment = payment.get({ plain: true });
      payment.account = account.get({ plain: true });
      emit(user.username, "payment", payment);
      emit(user.username, "account", account);

      res.send({ payment });
    });
  } catch (e) {
    delete redeeming[redeemcode];
    console.log(e);
    err("problem redeeming", e.message);
    return res.code(500).send("There was a problem redeeming the voucher");
  }
});

app.post("/checkRedeemCode", auth, async function(req, res) {
  const { redeemcode } = req.body;

  const payment = await db.Payment.findOne({ where: { redeemcode } });
  res.send(payment);
});

app.get("/payments/:hash", auth, async function(req, res) {
  try {
    let payment = await db.Payment.findOne({
      where: { user_id: req.user.id, hash: req.params.hash }
    });

    return payment.get({ plain: true });
  } catch (e) {
    console.log(e);
  }
});
