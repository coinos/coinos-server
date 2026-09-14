import config from "$config";
import got from "got";
import { l, err } from "$lib/logging";

export const callWebhook = async (invoice, payment) => {
  try {
    if (!invoice || !payment) return;

    const { address, received, text, webhook, secret } = invoice;

    if (webhook) {
      const { amount, confirmed, hash, memo } = payment;

      l("calling webhook", webhook, amount, hash, address, text);
      // TLS verification stays ON. This body carries `secret` — the shared
      // value the merchant uses to authenticate the notification — so with
      // rejectUnauthorized:false any party able to intercept the connection
      // could present its own certificate, harvest the secret, and then forge
      // "payment received" callbacks to that merchant. A merchant on a
      // self-signed cert now fails here instead, which the catch below logs;
      // the payment itself is unaffected.
      const res = await got.post(webhook, {
        json: {
          address,
          amount,
          confirmed,
          hash,
          memo,
          received,
          text,
          secret,
        },
      });
      return res;
    }
  } catch (e) {
    err("problem calling webhook", e.message);
  }
};
