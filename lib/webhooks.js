import config from "$config";
import wretch from "./wretch";
import { l } from "$lib/logging";

export const callWebhook = async (invoice, payment) => {
  try {
  if (!invoice || !payment) return;

  let { address, received, text, webhook } = invoice;

  if (webhook) {
    let { amount, confirmed, hash, memo, account } = payment;
    let { asset } = account;
    let secret = config.webhooks[webhook];

    l("calling webhook", webhook, amount, hash, address, text);
    let res = await wretch()
      .headers({ "x-webhook": secret })
      .url(webhook)
      .post({
        address,
        amount,
        asset,
        confirmed,
        hash,
        memo,
        received,
        text,
        webhook
      })
      .res()
    return res;
  }
  } catch(e) {
    console.log("problem calling webhook", e)
  } 
};
