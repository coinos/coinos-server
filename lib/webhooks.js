import config from "$config";
import got from "got";
import { l } from "$lib/logging";

export const callWebhook = async (invoice, payment) => {
  try {
    if (!invoice || !payment) return;

    let { address, received, text, webhook, secret } = invoice;

    if (webhook) {
      let { amount, confirmed, hash, memo } = payment;

      l("calling webhook", webhook, amount, hash, address, text);
      let res = await got.post(webhook, {
        json: {
          address,
          amount,
          confirmed,
          hash,
          memo,
          received,
          text,
          secret
        }
      });
      return res;
    }
  } catch (e) {
    console.log("problem calling webhook", e);
  }
};
