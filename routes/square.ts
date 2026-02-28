import * as crypto from "crypto";
import config from "$config";
import { db, g, s } from "$lib/db";
import { generate } from "$lib/invoices";
import { SATS, bail, getUser } from "$lib/utils";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { base64urlnopad as base64 } from "@scure/base";
import { SquareClient } from "square";
const { scopes, url, appId, clientSecret: _clientSecret, environment } = config.square;

export default {
  async connect(c) {
    const user = c.get("user");

    if (await db.exists(`${user.id}:square`)) {
      return c.json("connected");
    }

    const codeVerifier = base64.encode(crypto.randomBytes(32) as any);
    await s(`${user.id}:codeVerifier`, codeVerifier);

    const challenge = base64.encode(sha256(utf8ToBytes(codeVerifier)));

    const state = base64.encode(crypto.randomBytes(12) as any);
    const scope = scopes.join("+");

    return c.json(
      `${url}oauth2/authorize?client_id=${appId}&session=false&scope=${scope}&state=${state}&code_challenge=${challenge}`,
    );
  },

  async auth(c) {
    const user = c.get("user");

    const codeVerifier = await g(`${user.id}:codeVerifier`);

    const client = new SquareClient({
      environment,
    });

    const code = c.req.query("code");

    try {
      const result = await client.oAuth.obtainToken({
        code,
        clientId: appId,
        grantType: "authorization_code",
        codeVerifier,
      });

      await s(`${user.id}:square`, result);
      await s(result.merchantId, user.id);
      return c.json({});
    } catch (e) {
      console.log(e);
    }
  },

  async payment(c) {
    try {
      const body = await c.req.json();
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
          prompt: user.prompt,
          type: "lightning",
        };

        await generate({ invoice, user });
      }

      return c.json({});
    } catch (e) {
      return bail(c, e.message);
    }
  },
};
