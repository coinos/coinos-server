import { g, s, db } from "$lib/db";
import { get, claim, mint, check } from "$lib/ecash";
import { bail, fail } from "$lib/utils";
import { debit, credit, types } from "$lib/payments";
import { v4 } from "uuid";
import { l, err } from "$lib/logging";
import { emit } from "$lib/sockets";

let { ecash: type } = types;

export default {
  async save(req, res) {
    let {
      body: { token },
    } = req;
    try {
      let id = v4();
      await s(`cash:${id}`, token);
      res.send({ id });
    } catch (e) {
      err(e.message);
      bail(res, e.message);
    }
  },

  async get(req, res) {
    let {
      params: { id, version },
    } = req;
    try {
      let token = await get(id, version);
      let status = await check(token);
      res.send({ token, status });
    } catch (e) {
      err(e.message);
      bail(res, e.message);
    }
  },

  async claim(req, res) {
    let {
      body: { token },
      user,
    } = req;
    try {
      let amount = await claim(token);

      let memo;
      let hash = v4();
      let { currency, id: uid } = user;
      let rates = await g("rates");
      await s(`invoice:${hash}`, {
        currency,
        id: hash,
        hash,
        rate: rates[currency],
        uid,
        received: 0,
      });

      await credit({hash, amount, memo, ref:user.id, type});

      res.send({ ok: true });
    } catch (e) {
      err(e.message);
      bail(res, e.message);
    }
  },

  async mint(req, res) {
    let {
      body: { amount },
      user,
    } = req;
    try {
      let id = v4();
      let hash = v4();

      let memo, rate;
      let p = await debit({ hash, amount, user, type, memo, rate });
      let token = await mint(amount);
      p.memo = token;
      await s(`payment:${p.id}`, p);
      s(`cash:${id}`, token);

      res.send({ id });
    } catch (e) {
      err(e.message);
      bail(res, e.message);
    }
  },

  async melt(req, res) {
    let {
      body: { amount, bolt11: hash, preimage },
      user,
    } = req;
    try {
      amount = Math.round(amount / 1000);
      let ref = preimage;
      let { lightning: type } = types;
      if (user.username !== "mint") fail("unauthorized");
      let { id: uid, currency } = user;
      let ourfee = await db.debit(
        `balance:${uid}`,
        `credit:${type}:${uid}`,
        amount || 0,
        0,
        0,
        0,
      );

      let rates = await g("rates");
      let rate = rates[currency];

      if (ourfee.err) fail(ourfee.err);

      let id = v4();
      let p = {
        id,
        amount: -amount,
        hash,
        ourfee,
        uid,
        confirmed: true,
        rate,
        currency,
        type,
        ref,
        created: Date.now(),
      };

      await s(`payment:${hash}`, id);
      await s(`payment:${id}`, p);
      await db.lPush(`${uid}:payments`, id);

      l(user.username, "sent", type, amount);
      emit(user.id, "payment", p);

      res.send(p);
    } catch (e) {
      bail(res, e.message);
    }
  },
};
