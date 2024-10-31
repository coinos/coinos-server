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
        https: { rejectUnauthorized: false },
      });
      return res;
    }
  } catch (e) {
    err("problem calling webhook", e.message);
  }
};
