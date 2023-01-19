import config from "$config";
import store from "$lib/store";
import { emit } from "$lib/sockets";
import { v4 } from "uuid";
import { notify } from "$lib/notifications";
import { db, g, s, t } from "$lib/db";
import { l, err, warn } from "$lib/logging";
import { fail } from "$lib/utils";
import ln from "$lib/ln";
import { requirePin } from "$lib/auth";
import { callWebhook } from "$lib/webhooks";

const { HOSTNAME: hostname } = process.env;

let debit = async (user, amount, memo, to) => {
  let { id: uid, currency, username } = user;
  to = to && to.id;

  amount = parseInt(amount);

  if (!amount || amount < 0) fail("Amount must be greater than zero");

  await t(`balance:${uid}`, async balance => {
    await new Promise(r => setTimeout(r, 100));
    if (balance < amount) fail("Insufficient funds");
    return balance - amount;
  });

  let fee = 0;

  let hash = v4();

  let p = {
    hash,
    amount: -amount,
    memo,
    uid,
    rate: store.rates[currency],
    currency,
    type: "internal",
    to,
    created: Date.now()
  };

  if (!to) delete p.to;

  await s(`payment:${hash}`, p);
  await db.lPush(`${uid}:payments`, hash);

  l("sent internal", user.username, amount);
  emit(user.id, "payment", p);

  return p;
};

let credit = async (hash, amount, memo, from) => {
  let invoice = await g(`invoice:${hash}`);
  let user = await g(`user:${invoice.uid}`);

  let { id: uid, currency, username } = user;
  from = from.id;

  let p = {
    hash,
    amount,
    uid,
    rate: store.rates[currency],
    currency,
    memo,
    type: memo === "pot" ? "pot" : "internal",
    from,
    created: Date.now()
  };

  let { tip } = invoice;
  if (tip) {
    p.tip = tip;
    p.amount -= tip;
  }

  invoice.received += amount;
  await s(`invoice:${hash}`, invoice);
  await s(`payment:${hash}`, p);
  await db.lPush(`${uid}:payments`, hash);

  l("received internal", username, amount);
  emit(username, "payment", p);
  notify(user, `Received ${amount} sats`);
  callWebhook(invoice, p);

  return p;
};

export default {
  async send({ body, user }, res) {
    let { amount, hash, name, memo, tip } = body;
    await requirePin({ body, user });

    let invoice, recipient;

    let p = await debit(user, amount, memo, recipient);

    if (hash) {
      await credit(hash, amount, memo, user);
    } else {
      let pot = name || v4();
      await db.incrBy(`pot:${pot}`, amount);
      await db.lPush(`pot:${pot}:payments`, p.hash);
      l("funded pot", pot);
    }

    res.send(p);
  },

  async list({ user: { id }, query: { start, end, limit, offset } }, res) {
    if (limit) limit = parseInt(limit);
    if (offset) offset = parseInt(offset);

    // if (start || end) where.createdAt = {};
    // if (start) where.createdAt[Op.gte] = new Date(parseInt(start));
    // if (end) where.createdAt[Op.lte] = new Date(parseInt(end));

    let payments = (await db.lRange(`${id}:payments`, 0, -1)) || [];
    payments = await Promise.all(payments.map(hash => g(`payment:${hash}`)));
    payments = payments.filter(p => p);
    res.send({ payments, total: payments.length });
  },

  async voucher(req, res) {
    try {
      const { redeemcode } = req.params;
      let payment = await g(`voucher:${id}`);

      payment = payment.get({ plain: true });
      payment.redeemer = payment["with"];

      if (!payment) fail("invalid code");

      res.send(payment);
    } catch (e) {
      res.code(500).send(e.message);
    }
  },

  async get({ params: { hash } }, res) {
    res.send(await g(`payment:${hash}`));
  },

  async redeem({ body: { redeemcode } }, res) {
    try {
      await db.transaction(async transaction => {
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
      console.log(e);
      err("problem redeeming", e.message);
      return res.code(500).send("There was a problem redeeming the voucher");
    }
  },

  async sendLightning({ body: { payreq } }, res) {
    let hour = 1000 * 60 * 60;
    let { last } = store.nodes;
    let { nodes } = store;

    if (!last || last > Date.now() - hour) ({ nodes } = await ln.listnodes());
    store.nodes = nodes;

    let twoWeeksAgo = new Date(new Date().setDate(new Date().getDate() - 14));
    let { msatoshi, payee } = await ln.decodepay(payreq);
    let node = nodes.find(n => n.nodeid === payee);
    let alias = node ? node.alias : payee.substr(0, 12);

    res.send({ alias, amount: Math.round(msatoshi / 1000) });
  },

  async pot({ params: { name } }, res) {
    let amount = await g(`pot:${name}`);
    let payments = (await db.lRange(`pot:${name}:payments`, 0, -1)) || [];
    payments = await Promise.all(payments.map(hash => g(`payment:${hash}`)));

    await Promise.all(
      payments.map(async p => (p.user = await g(`user:${p.uid}`)))
    );

    payments = payments.filter(p => p);
    res.send({ amount, payments });
  },

  async withdraw({ body: { name, amount }, user }, res) {
    amount = parseInt(amount);
    await t(`pot:${name}`, async balance => {
      await new Promise(r => setTimeout(r, 100));
      if (balance < amount) fail("Insufficient funds");
      return balance - amount;
    });

    let hash = v4();
    await s(`invoice:${hash}`, {
      uid: user.id,
      received: 0
    });

    let payment = await credit(hash, amount, "pot", { id: name });
    await db.lPush(`pot:${name}:payments`, hash);

    res.send({ payment });
  },

  async bitcoin({ body }, res) {
    console.log(body);
    res.send({});
  }
};
