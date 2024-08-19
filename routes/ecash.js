import { g, s } from "$lib/db";
import { claim, mint } from "$lib/ecash";
import { bail } from "$lib/utils";
import { debit, credit, types } from "$lib/payments";
import { v4 } from "uuid";
import store from "$lib/store";

let { ecash: type } = types;

export default {
  async claim({ body: { token }, user }, res) {
    try {
      let amount = await claim(token);

      let memo;
      let hash = v4();
      let { currency, id: uid } = user;
      await s(`invoice:${hash}`, {
        currency,
        id: hash,
        hash,
        rate: store.rates[currency],
        uid,
        received: 0,
      });

      await credit(hash, amount, memo, user.id, type);

      res.send({ ok: true });
    } catch (e) {
      bail(res, e.message);
    }
  },

  async mint({ body: { amount }, user }, res) {
    try {
      let hash = v4();

      let p = await debit({ hash, amount, user, type });
      let token = await mint(amount);
      p.memo = token;
      await s(`payment:${p.id}`, p);

      res.send({ token });
    } catch (e) {
      bail(res, e.message);
    }
  },
};
