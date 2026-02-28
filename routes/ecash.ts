import { db, g, s } from "$lib/db";
import { check, claim, get, mint } from "$lib/ecash";
import { err, l } from "$lib/logging";
import { credit, debit } from "$lib/payments";
import { emit } from "$lib/sockets";
import { tbDebit } from "$lib/tb";
import { bail, fail, getInvoice } from "$lib/utils";
import { getEncodedToken } from "@cashu/cashu-ts";
import { v4 } from "uuid";

import { PaymentType } from "$lib/types";
const { ecash: type } = PaymentType;

Error.stackTraceLimit = 100;

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
  async save(c) {
    const { token } = await c.req.json();
    try {
      const id = v4();
      await s(`cash:${id}`, token);
      return c.json({ id });
    } catch (e) {
      err(e.message);
      return bail(c, e.message);
    }
  },

  async get(c) {
    const id = c.req.param("id");
    try {
      const token = await get(id);
      const status = await check(token);
      return c.json({ token, status });
    } catch (e) {
      err(e.message);
      return bail(c, e.message);
    }
  },

  async claim(c) {
    const { token } = await c.req.json();
    const user = c.get("user");
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

      return c.json({ ok: true });
    } catch (e) {
      err(e.message);
      return bail(c, e.message);
    }
  },

  async mint(c) {
    const body = await c.req.json();
    const user = c.get("user");
    const amount = parseInt(body.amount);
    fail("disabled");
    return c.json(await sendCash({ amount, user }));
  },

  async melt(c) {
    const body = await c.req.json();
    const user = c.get("user");
    let { amount, bolt11: hash, preimage } = body;
    try {
      amount = Math.round(amount / 1000);
      const ref = preimage;
      const { lightning: type } = PaymentType;
      if (user.username !== "mint") fail("unauthorized");
      const { id: uid, currency } = user;
      const ourfee = await tbDebit(uid, uid, type, amount || 0, 0, 0, 0, 0, "Insufficient funds");

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

      return c.json(p);
    } catch (e) {
      return bail(c, e.message);
    }
  },

  async receive(c) {
    try {
      const body = await c.req.json();
      const { id, proofs, mint, memo } = body;
      const { uid: ref } = await getInvoice(id);

      const amount = await claim(
        getEncodedToken({
          mint,
          proofs,
        }),
      );

      await credit({ hash: id, amount, memo, ref, type });

      return c.json({ id });
    } catch (e) {
      console.log(e);
      err(e.message);
      return bail(c, e.message);
    }
  },
};
