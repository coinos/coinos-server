import { emit } from "$lib/sockets";
import { db, g, s } from "$lib/db";
import { l, err, warn } from "$lib/logging";
import { fail } from "$lib/utils";
import ln from "$lib/ln";
import sendInternal from "$lib/sendInternal";
import { requirePin } from "$lib/auth";

export default {
  async send(req, res) {
    await requirePin(req);
    let payment = await sendInternal(req.body, req.user);
    res.send(payment);
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
  }
};
