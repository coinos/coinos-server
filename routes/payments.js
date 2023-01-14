import app from "$app";
import config from "$config";
import store from "$lib/store";
import { g, rd } from "$lib/redis";

import { auth, adminAuth, optionalAuth } from "$lib/passport";
import fs from "fs";
import { join } from "path";
import send from "./send";
import { err, l, warn } from "$lib/logging";
import { fail } from "$lib/utils";
import { emit } from "$lib/sockets";

import lnRoutes from "./lightning/index";
import "./lightning/receive";

app.post("/send", auth, send);

app.post("/lightning/parse", lnRoutes.parse);
app.post("/lightning/query", auth, lnRoutes.query);
app.post("/lightning/send", auth, lnRoutes.send);

app.get(
  "/payments",
  auth,
  async ({ user: { id }, query: { start, end, limit, offset } }, res) => {
    if (limit) limit = parseInt(limit);
    if (offset) offset = parseInt(offset);

    // if (start || end) where.createdAt = {};
    // if (start) where.createdAt[Op.gte] = new Date(parseInt(start));
    // if (end) where.createdAt[Op.lte] = new Date(parseInt(end));

    let payments = (await rd.lRange(`${id}:payments`, 0, -1)) || [];
    payments = await Promise.all(payments.map(id => g(`payment:${id}`)));
    payments = payments.filter(p => p);
    res.send({ payments, total: payments.length });
  }
);

// app.get("/voucher/:redeemcode", async (req, res) => {
//   try {
//     const { redeemcode } = req.params;
//     let payment = await db.Payment.findOne({
//       where: {
//         redeemcode
//       },
//       include: { all: true }
//     });
//
//     payment = payment.get({ plain: true });
//     payment.redeemer = payment["with"];
//
//     if (!payment) fail("invalid code");
//
//     res.send(payment);
//   } catch (e) {
//     res.code(500).send(e.message);
//   }
// });

// let redeeming = {};
// app.post("/redeem", optionalAuth, async function(req, res) {
//   const { redeemcode } = req.body;
//   try {
//     await db.transaction(async transaction => {
//       if (redeeming[redeemcode]) fail("redemption in progress");
//       redeeming[redeemcode] = true;
//       if (!redeemcode) fail("no code provided");
//
//       let { user } = req;
//
//       const source = await db.Payment.findOne({
//         where: {
//           redeemcode: req.body.redeemcode
//         },
//         include: {
//           model: db.Account,
//           as: "account"
//         },
//         lock: transaction.LOCK.UPDATE,
//         transaction
//       });
//
//       l("redeeming", redeemcode);
//
//       if (!source) fail("Invalid code");
//       if (source.redeemed) fail("Voucher has already been redeemed");
//       let { amount } = source;
//       amount = -amount;
//
//       if (!user) {
//         const ip =
//           req.headers["x-forwarded-for"] || req.connection.remoteAddress;
//
//         user = await register(
//           {
//             username: redeemcode.substr(0, 8),
//             password: ""
//           },
//           ip,
//           false
//         );
//
//         let payload = { username: user.username };
//         let token = jwt.sign(payload, config.jwt);
//         res.cookie("token", token, {
//           expires: new Date(Date.now() + 432000000)
//         });
//
//         delete redeeming[redeemcode];
//         return res.send({ user });
//       }
//
//       let account = await getAccount(source.account.asset, user, transaction);
//       let { hash, memo, confirmed, fee, network } = source;
//
//       source.redeemed = true;
//       (source.with_id = user.id), await source.save({ transaction });
//
//       let payment = await db.Payment.create(
//         {
//           amount,
//           account_id: account.id,
//           user_id: user.id,
//           hash: "Voucher " + redeemcode,
//           memo,
//           rate: store.rates[user.currency],
//           currency: user.currency,
//           confirmed,
//           network,
//           received: true,
//           fee,
//           with_id: source.user_id
//         },
//         { transaction }
//       );
//
//       await account.increment({ balance: amount }, { transaction });
//       await account.reload({ transaction });
//
//       payment = payment.get({ plain: true });
//       payment.account = account.get({ plain: true });
//       emit(user.username, "payment", payment);
//       emit(user.username, "account", account);
//
//       res.send({ payment });
//     });
//   } catch (e) {
//     delete redeeming[redeemcode];
//     console.log(e);
//     err("problem redeeming", e.message);
//     return res.code(500).send("There was a problem redeeming the voucher");
//   }
// });
//
// app.post("/checkRedeemCode", auth, async function(req, res) {
//   const { redeemcode } = req.body;
//
//   const payment = await db.Payment.findOne({ where: { redeemcode } });
//   res.send(payment);
// });
//
// app.get("/payments/:hash", auth, async function(req, res) {
//   try {
//     let payment = await db.Payment.findOne({
//       where: { user_id: req.user.id, hash: req.params.hash }
//     });
//
//     return payment.get({ plain: true });
//   } catch (e) {
//     console.log(e);
//   }
// });
