import * as crypto from "crypto";
import config from "$config";
import { db, g, s } from "$lib/db";
import { generate } from "$lib/invoices";
import { SATS, bail, getUser } from "$lib/utils";
import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes } from "@noble/hashes/utils";
import { base64urlnopad as base64 } from "@scure/base";
import { SquareClient } from "square";

const { scopes, url, appId, environment } = config.square;

export default {
  async connect(req, res) {
    const { user } = req;

    if (await db.exists(`${user.id}:square`)) {
      return res.send("connected");
    }

    const codeVerifier = base64.encode(crypto.randomBytes(32));
    await s(`${user.id}:codeVerifier`, codeVerifier);

    const challenge = base64.encode(sha256(utf8ToBytes(codeVerifier)));

    const state = base64.encode(crypto.randomBytes(12));
    const scope = scopes.join("+");

    res.send(
      `${url}oauth2/authorize?client_id=${appId}&session=false&scope=${scope}&state=${state}&code_challenge=${challenge}`,
    );
  },

  async auth(req, res) {
    const { user } = req;

    const codeVerifier = await g(`${user.id}:codeVerifier`);

    const client = new SquareClient({
      environment,
    });

    const { code } = req.query;

    try {
      const result = await client.oAuth.obtainToken({
        code,
        clientId: appId,
        grantType: "authorization_code",
        codeVerifier,
      });

      await s(`${user.id}:square`, result);
      await s(result.merchantId, user.id);
      res.send({});
    } catch (e) {
      console.log(e);
    }
  },

  async payment(req, res) {
    try {
      const { body } = req;
      const { data, type, merchant_id } = body;
      const { payment } = data.object;

      if (
        type === "payment.created" &&
        (payment.source_type === "CASH" || payment.source_type === "EXTERNAL")
      ) {
        const {
          amount_money: { amount, currency },
        } = payment;
        const rates = await g("rates");
        const rate = rates[currency];
        const uid = await g(merchant_id);
        const user = await getUser(uid);
        const invoice = {
          amount: Math.round(((amount / 100) * SATS) / rate),
          own: true,
          type: "lightning",
        };

        await generate({ invoice, user });
      }

      res.send({});
    } catch (e) {
      bail(res, e.message);
    }
  },
};
