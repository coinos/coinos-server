import { db, g, s } from "$lib/db";
import { check, claim, get, mint } from "$lib/ecash";
import { err, l } from "$lib/logging";
import { credit, debit } from "$lib/payments";
import { emit } from "$lib/sockets";
import { bail, fail } from "$lib/utils";
import { getEncodedToken } from "@cashu/cashu-ts";
import { v4 } from "uuid";

import { PaymentType } from "$lib/types";
const { ecash: type } = PaymentType;

Error.stackTraceLimit = 100; // Set this to the desired limit

const sendCash = async ({ amount, user }) => {
  const id = v4();
  const hash = v4();

  const p = await debit({ hash, amount, user, type });
  const token = await mint(parseInt(amount));
  p.memo = id;
  const { id: pid } = p;
  await s(`payment:${pid}`, p);
  s(`cash:${id}`, token);

  return { id, token, pid };
};

export default {
  async save(req, res) {
    const {
      body: { token },
    } = req;
    try {
      const id = v4();
      await s(`cash:${id}`, token);
      res.send({ id });
    } catch (e) {
      err(e.message);
      bail(res, e.message);
    }
  },

  async get(req, res) {
    const {
      params: { id },
    } = req;
    try {
      const token = await get(id);
      const status = await check(token);
      res.send({ token, status });
    } catch (e) {
      err(e.message);
      bail(res, e.message);
    }
  },

  async claim(req, res) {
    const {
      body: { token },
      user,
    } = req;
    try {
      const amount = await claim(token);

      let memo;
      const hash = v4();
      const { currency, id: uid } = user;
      const rates = await g("rates");
      await s(`invoice:${hash}`, {
        currency,
        id: hash,
        hash,
        rate: rates[currency],
        uid,
        received: 0,
      });

      await credit({ hash, amount, memo, ref: user.id, type });

      res.send({ ok: true });
    } catch (e) {
      err(e.message);
      bail(res, e.message);
    }
  },

  async mint(req, res) {
    const { body, user } = req;
    const amount = parseInt(body.amount);
    res.send(await sendCash({ amount, user }));
  },

  async melt(req, res) {
    let {
      body: { amount, bolt11: hash, preimage },
      user,
    } = req;
    try {
      amount = Math.round(amount / 1000);
      const ref = preimage;
      const { lightning: type } = PaymentType;
      if (user.username !== "mint") fail("unauthorized");
      const { id: uid, currency } = user;
      const ourfee = await db.debit(
        `balance:${uid}`,
        `credit:${type}:${uid}`,
        amount || 0,
        0,
        0,
        0,
      );

      const rates = await g("rates");
      const rate = rates[currency];

      if (ourfee.err) fail(ourfee.err);

      const id = v4();
      const p = {
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

  async receive(req, res) {
    try {
      const { id, proofs, mint, memo } = req.body;
      const { uid: ref } = await g(`invoice:${id}`);

      const amount = await claim(
        getEncodedToken({
          mint,
          proofs,
        }),
      );

      await credit({ hash: id, amount, memo, ref, type });

      res.send({ id });
    } catch (e) {
      console.log(e);
      err(e.message);
      bail(res, e.message);
    }
  },
};
